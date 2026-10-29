// Fork (Jamie Unwin, 29 Oct 2026) — not in René's Deep Roon: an album's credits and its version group, written with
// Library::Edit (the path Roon's own album editor takes). Each change is read back with GetAlbumEditInfo: the Core can
// answer Success and change nothing (an unknown role, say).
//
// What the edit info shows (measured 29 Oct 2026, Roon 2.74 build 1717): every field has layers — Local (the file's
// tags), Metadata (Roon's data), the Base Roon picks from those, and the user's Edit on top. A version group is
// DuplicateOf on the lesser copies, pointing at the primary: a group Roon made itself carries only the computed Value
// (Oddments, Telas); a group made here is an EditValue. Copies Roon identified as different albums (Yowsers, the local
// rip, metadata album 87036793; Yowzers at Qobuz, 79792584) aren't grouped and aren't each other's "other versions".
import { isRef } from '../intern';
import { PropertyType } from '../intern/proto/objects';
import { BinaryReader } from '../intern/proto/reader';
import { BinaryWriter } from '../intern/proto/writer';
import { Arg, buildArgs } from '../intern/proto/serializer';
import { withCore, RoonError } from '../core/session';
import { log } from '../core/log';
import { Any, C, albumRow, field, items, obj, short, untilField, untilLoaded, wait } from './graph';
import { findAlbum, fullAlbum, performer } from './library';

const API = 'Sooloos.Broker.Api.';
const LIBRARY_EDIT = `${API}LibraryEdit`, ALBUM_EDIT = `${API}AlbumEdit`, CREDIT_EDIT = `${API}CreditEdit`;
// The two closed edit wrappers used here aren't in the generated schemas: the members are named the way the Core names
// those of its own EditListInfo<Credit> and EditOptionalRefInfo<AlbumLite> (read 29 Oct 2026).
const CREDITS = `${API}EditList<${CREDIT_EDIT}>`, DUPLICATE_OF = `${API}EditOptionalRef<${API}AlbumLite>`;

type Member = { name: string; propType: number; value: Buffer };
/** A list as struct members and answers carry it: int(bytes), flexInt(count), the items. */
const lengthList = (els: Buffer[]) => { const b = new BinaryWriter().flexInt(els.length).bytes(Buffer.concat(els)).toBuffer(); return new BinaryWriter().integer(b.length).bytes(b).toBuffer(); };
/** The items of a by-value list in a LengthPrefixed member (its length already read): flexInt(count), then each value. */
function valueList(c: C, v: Any): Any[] {
  if (!Buffer.isBuffer(v) || v.length < 1) return [];
  const r = new BinaryReader(Uint8Array.from(v));
  const n = r.flexInt(); const out: Any[] = [];
  const graph = c.graph as Any;   // readValue isn't part of the graph's public surface
  for (let i = 0; i < n && r.remaining > 0; i++) out.push(graph.readValue(r, PropertyType.Object));
  return out;
}

// ---- finding the albums ----
// René's findAlbum: the graph, else Library::GetAlbumLite with 4 s for the answer and 2 s for the album to arrive — and
// one message, "Roon knows no album", for the three ways that can fail. Reported 29 Oct 2026 on two Qobuz albums in the
// library that roon_search finds at once (Personal History 2109487; Benita, Time for a Change 2634543):
// roon_versions_group failed on them twice in a row, and worked as soon as roon_versions had loaded the album or one of
// its copies. Not reproduced: on a new connection both keys resolve in under 0.1 s, alone, after a search, or after
// their other copy. So, in turn: the quick lookup; the versions of the albums that were found (what fixed it for the
// reporter); one patient ask; and an error that says which way it failed (also in the log).

const inGraph = (c: C, key: string) => [...c.graph.objects.values()].find((o) => /\.Album(Lite)?$/.test(o.typeName) && String(field(o, 'AlbumId') ?? '') === key && field(o, 'Title') !== undefined);

/** One patient Library::GetAlbumLite: up to 15 s for the answer (a request's own limit) and 5 s for the album to arrive. */
async function askForAlbum(c: C, key: string): Promise<{ al?: Any; why?: string }> {
  const t0 = Date.now();
  const res = await short(c.call('Library', 'GetAlbumLite', [{ type: 'long', name: 'albumid' }, { type: 'ResultCallback<AlbumLite>', name: 'cb_result' }],
    buildArgs([Arg.long(BigInt(key))]), c.serviceOid('Library')), 15000);
  let al: Any, why: string | undefined;
  if (!res) why = 'no answer within 15 s (Roon busy, or a key it doesn\'t know)';
  else if (!res.success) why = `Roon answered ${res.status}`;
  else {
    const v = res.payload.length ? c.graph.decodeReturnValue(Uint8Array.from(res.payload)) : null;
    if (!isRef(v)) why = 'Roon answered without an album';
    else {
      await untilLoaded(c, [v], 5000);
      const o = c.graph.getObject(v.$ref);
      if (o && field(o, 'Title') !== undefined) al = o;
      else why = o ? `Roon named the album (object ${v.$ref}) but didn't send its details` : `Roon named an album (object ${v.$ref}) but never sent it`;
    }
  }
  log(`album lookup ${key}: ${al ? 'found' : why} after ${Date.now() - t0} ms`);
  return { al, why };
}

/** The library versions an album's page lists — its group and the other copies Roon knows — loaded into the graph, the
 *  way roon_versions comes to hold them. */
async function loadVersions(c: C, al: Any): Promise<void> {
  const full = await fullAlbum(c, al);
  if (!isRef(full)) return;
  await untilField(c, full.$ref, 'AlternateVersionsReady', 4500);
  const av = obj(c, field(c.graph.getObject(full.$ref), 'AlternateAlbumVersions'));
  await untilLoaded(c, ['LibraryGroupVersions', 'LibraryOtherVersions'].flatMap((n) => items(c, field(av, n))).map((x) => field(x, 'Album')).filter(isRef), 2500);
}

/** The albums for keys as they are in the library (only those have edit layers), in the order of the keys. */
async function libraryAlbums(c: C, keys: string[]): Promise<Any[]> {
  const found = new Map<string, Any>();
  for (const k of keys) {
    try { found.set(k, await findAlbum(c, k)); }
    catch (e) { if (!(e instanceof RoonError && e.kind === 'not_found')) throw e; }
  }
  let missing = keys.filter((k) => !found.has(k));
  if (missing.length && found.size) {
    for (const al of found.values()) await loadVersions(c, al);
    for (const k of missing) { const o = inGraph(c, k); if (o) found.set(k, o); }
    missing = keys.filter((k) => !found.has(k));
  }
  for (const k of missing) {
    const { al, why } = await askForAlbum(c, k);
    if (!al) throw new RoonError(`Roon knows no album with key ${k}: ${why}. Check the key with roon_search; if it finds the album, try again in a minute`, 'not_found');
    found.set(k, al);
  }
  return keys.map((k) => {
    const al = found.get(k);
    if (field(al, 'Source') !== 1) throw new RoonError(`"${field(al, 'Title')}" (${k}) isn't in the library — roon_library_add first`, 'invalid');
    return al;
  });
}
const libraryAlbum = async (c: C, key: string): Promise<Any> => (await libraryAlbums(c, [key]))[0];
const idOf = (al: Any) => BigInt(field(al, 'AlbumId'));
const editInfo = async (c: C, al: Any) => (await c.getAlbumEditInfo(al.oid)).raw;

/** One Library::Edit with an AlbumEdit per album: {AlbumId, the members to change}. */
async function edit(c: C, albums: { al: Any; members: Member[] }[]): Promise<void> {
  const edits = albums.map(({ al, members }) => c.structArg(ALBUM_EDIT, [{ name: `long ${ALBUM_EDIT}::AlbumId`, propType: PropertyType.Long, value: new BinaryWriter().long(idOf(al)).toBuffer() }, ...members]));
  const arg = c.structArg(LIBRARY_EDIT, [{ name: `System.Collections.Generic.IList<${ALBUM_EDIT}> ${LIBRARY_EDIT}::Albums`, propType: PropertyType.LengthPrefixed, value: lengthList(edits) }]);
  const res = await short(c.call('Library', 'Edit', [{ type: 'LibraryEdit', name: 'edit' }, { type: 'ResultCallback', name: 'cb' }], arg, c.serviceOid('Library')), 15000);
  if (!res) throw new RoonError('Roon didn\'t answer the edit within 15 s. Look at the album in Roon; if Roon misbehaves, restart the Core.');
  if (!res.success) throw new RoonError(`Roon refused the edit (${res.status})`);
}

// ---- credits ----
interface CreditRow { artist_key: string; artist: string; role: string }
/** The album's credits as Roon shows them (Values), Roon's own without the user's edits (BaseValues), and those edits
 *  (AddValues, RemoveValues). */
async function creditsOf(c: C, al: Any): Promise<{ all: CreditRow[]; base: CreditRow[]; added: CreditRow[]; removed: CreditRow[] }> {
  const w = field(await editInfo(c, al), 'Credits');
  const [all, base, added, removed] = ['Values', 'BaseValues', 'AddValues', 'RemoveValues'].map((n) => valueList(c, field(w, n)));
  await untilLoaded(c, [...all, ...base, ...added, ...removed].map((x) => field(x, 'Performer')).filter(isRef), 2000);
  const row = (x: Any): CreditRow => { const p = obj(c, field(x, 'Performer')); return { artist_key: String(field(p, 'PerformerId') ?? ''), artist: field(p, 'Name') ?? '', role: field(x, 'Role') ?? '' }; };
  return { all: all.map(row), base: base.map(row), added: added.map(row), removed: removed.map(row) };
}
/** AlbumEdit.Credits, an EditList<CreditEdit>: ClearEdits drops the album's credit edits, AddValues and RemoveValues add to
 *  them. Always the three members: the type is defined once per connection, with the members it's sent with. */
function creditsEdit(c: C, o: { clearEdits?: boolean; add?: CreditRow[]; remove?: CreditRow[] }): Member {
  const ce = (x: CreditRow) => c.structArg(CREDIT_EDIT, [
    { name: `long ${CREDIT_EDIT}::Performer`, propType: PropertyType.Long, value: new BinaryWriter().long(BigInt(x.artist_key)).toBuffer() },
    { name: `string ${CREDIT_EDIT}::Role`, propType: PropertyType.String, value: new BinaryWriter().string(x.role).toBuffer() },
  ]);
  return { name: `${CREDITS} ${ALBUM_EDIT}::Credits`, propType: PropertyType.Object, value: c.structArg(CREDITS, [
    { name: `bool ${CREDITS}::ClearEdits`, propType: PropertyType.Bool, value: new BinaryWriter().boolean(o.clearEdits === true).toBuffer() },
    { name: `System.Collections.Generic.IList<${CREDIT_EDIT}> ${CREDITS}::AddValues`, propType: PropertyType.LengthPrefixed, value: lengthList((o.add ?? []).map(ce)) },
    { name: `System.Collections.Generic.IList<${CREDIT_EDIT}> ${CREDITS}::RemoveValues`, propType: PropertyType.LengthPrefixed, value: lengthList((o.remove ?? []).map(ce)) },
  ]) };
}

/** A credit on (or off) an album: an artist Roon knows, in a role. Off also takes the artist's name from the album's credits. */
export async function albumCredit(key: string, artist: string, role: string, on: boolean) {
  return withCore(async (c) => {
    const al = await libraryAlbum(c, key);
    const before = await creditsOf(c, al);
    const wantRole = role.trim().toLowerCase();
    let artistKey = artist.trim(), name: string;
    if (/^\d+$/.test(artistKey)) {
      const lv = await performer(c, artistKey);
      await untilLoaded(c, [lv], 1500);
      name = field(obj(c, lv), 'Name') ?? artistKey;
    } else {
      const hit = on ? undefined : before.all.find((x) => x.artist.toLowerCase() === artistKey.toLowerCase() && x.role.toLowerCase() === wantRole);
      if (!hit) throw new RoonError(on ? 'artist: an artist key (roon_search with kind artist)' : `No credit "${artist}" as ${role} on this album`, 'invalid');
      artistKey = hit.artist_key; name = hit.artist;
    }
    const same = (x: CreditRow) => x.artist_key === artistKey && x.role.toLowerCase() === wantRole;
    const had = before.all.find(same);
    const credit: CreditRow = { artist: name, artist_key: artistKey, role: had?.role ?? role.trim() };
    if (!!had === on) return { ok: true, album: albumRow(c, al), credit, credited: on, note: on ? 'Already credited — nothing changed' : 'No such credit on this album — nothing changed' };
    // Undoing an edit leaves no trace, as in Roon's own editor (measured 29 Oct 2026: its delete of a credit the user had
    // added left the credit edits empty). Roon's lists don't do that by themselves — a RemoveValues for a credit that's
    // only in AddValues stays behind as a removal — so an undo drops the album's credit edits and puts the others back.
    const inBase = before.base.some(same);
    const undo = on ? inBase && before.removed.some(same) : !inBase && before.added.some(same);
    const steps: string[] = [];
    if (undo) {
      const add = before.added.filter((x) => !same(x)), remove = before.removed.filter((x) => !same(x));
      await edit(c, [{ al, members: [creditsEdit(c, { clearEdits: true })] }]);
      steps.push('dropped the credit edits');
      if (add.length || remove.length) {
        await wait(300);
        await edit(c, [{ al, members: [creditsEdit(c, { add, remove })] }]);
        steps.push(`put the other ${add.length + remove.length} back`);
      }
    } else {
      await edit(c, [{ al, members: [creditsEdit(c, on ? { add: [credit] } : { remove: [credit] })] }]);
      steps.push(on ? 'added' : 'removed');
    }
    log(`album_credit: ${field(al, 'Title')} ${on ? '+' : '−'} ${name} (${credit.role}): ${steps.join(', ')}`);
    await wait(500);
    const after = await creditsOf(c, al);
    const now = !!after.all.find(same);
    return { ok: now === on, album: albumRow(c, al), credit, credited: now, steps, your_edits: { added: after.added, removed: after.removed },
             note: now === on ? undefined : `Roon said ok, but nothing changed${on ? ' — use a role Roon knows, as roon_album shows them with credits: true ("Piano", "Producer", "Drums" …)' : ''}` };
  });
}

// ---- version groups ----
/** Which album this one is a lesser copy of (DuplicateOf); whether that's an edit rather than Roon's own grouping; and
 *  whether it's marked a duplicate of nothing (ClearBaseValue — what Roon's editor puts on a group's primary). */
async function duplicateOf(c: C, al: Any): Promise<{ of?: string; parent?: Any; edited: boolean; primary: boolean }> {
  const w = field(await editInfo(c, al), 'DuplicateOf');
  const v = field(w, 'Value');
  if (isRef(v)) await untilLoaded(c, [v], 1500);
  const parent = isRef(v) ? obj(c, v) : undefined;
  const primary = field(w, 'ClearBaseValue') === true;
  return { of: parent ? String(field(parent, 'AlbumId') ?? '') : undefined, parent, edited: field(w, 'EditValue') !== undefined || primary, primary };
}
const keyOf = (al: Any) => String(field(al, 'AlbumId') ?? '');
/** The primary of the group an album is in: DuplicateOf followed to the album that's a duplicate of nothing. Roon's own
 *  groups can chain — reported 29 Oct 2026 on Lee Douglas, New York Story: 1668143 under 152367, 152367 under 2454063 —
 *  so the first link isn't always the primary. `via`: the albums passed on the way, the primary last. */
async function primaryOf(c: C, al: Any): Promise<{ primary: Any; via: string[] }> {
  const via: string[] = [];
  let cur = al;
  for (let i = 0; i < 10; i++) {
    const d = await duplicateOf(c, cur);
    if (!d.of || d.of === keyOf(cur) || via.includes(d.of)) break;
    via.push(d.of);
    cur = d.parent && field(d.parent, 'Title') !== undefined ? d.parent : await libraryAlbum(c, d.of);
  }
  return { primary: cur, via };
}
/** DuplicateOf as an edit: the primary's object (into its group), ClearEdits (drop an edit made earlier), or ClearBaseValue
 *  (overrule Roon's own grouping). Always the same three members, as with the credits. */
function duplicateEdit(c: C, o: { primary?: bigint; clearEdits?: boolean; clearBase?: boolean }): Member {
  return { name: `${DUPLICATE_OF} ${ALBUM_EDIT}::DuplicateOf`, propType: PropertyType.Object, value: c.structArg(DUPLICATE_OF, [
    { name: `bool? ${DUPLICATE_OF}::ClearBaseValue`, propType: PropertyType.NullableBool, value: new BinaryWriter().optionalBoolean(o.clearBase ? true : null).toBuffer() },
    { name: `bool ${DUPLICATE_OF}::ClearEdits`, propType: PropertyType.Bool, value: new BinaryWriter().boolean(o.clearEdits === true).toBuffer() },
    { name: `${API}AlbumLite ${DUPLICATE_OF}::EditValue`, propType: PropertyType.Object, value: new BinaryWriter().long(o.primary ?? 0n).toBuffer() },
  ]) };
}
/** An album with where it sits: `version_of` the album it points at, `group_primary` the group's primary when that's another. */
const versionRow = (c: C, al: Any, d: { of?: string }, groupPrimary?: string) =>
  ({ ...albumRow(c, al), version_of: d.of, group_primary: groupPrimary && groupPrimary !== d.of && groupPrimary !== keyOf(al) ? groupPrimary : undefined });

/** Albums of the library as versions of one album: the primary of the first album's group — the first album itself,
 *  unless it's already a version in a group, whose primary then stays (reported 29 Oct 2026: ten calls refused with
 *  "make that one the first key"; switching a group's primary isn't done here). An album that was taken out of a group
 *  Roon made goes back by dropping that edit, so Roon's own grouping holds again; otherwise DuplicateOf points at the
 *  primary, and the primary is marked a duplicate of nothing — both as Roon's own Edit › Group alternate versions writes
 *  them (measured 29 Oct 2026 on Yowzers/Yowsers: EditValue on the lesser copy, ClearBaseValue on the primary). */
export async function groupVersions(keys: string[]) {
  return withCore(async (c) => {
    const unique = [...new Set(keys.map((k) => k.trim()))];
    if (unique.length < 2) throw new RoonError('Two or more album keys: the first becomes the primary version', 'invalid');
    const albums = await libraryAlbums(c, unique);
    const steps: string[] = [];
    const { primary, via } = await primaryOf(c, albums[0]);
    const pk = keyOf(primary);
    if (via.length) steps.push(`${unique[0]} is already a version in the group of ${pk}${via.length > 1 ? ` (via ${via.slice(0, -1).join(', ')})` : ''}, so ${pk} stays the primary`);
    let marked = (await duplicateOf(c, primary)).primary;
    const others = albums.filter((al, i) => keyOf(al) !== pk && albums.findIndex((x) => keyOf(x) === keyOf(al)) === i);
    for (const al of others) {
      const k = keyOf(al);
      if (keyOf((await primaryOf(c, al)).primary) === pk) { steps.push(`${k}: already in the group`); continue; }
      if ((await duplicateOf(c, al)).edited) {
        await edit(c, [{ al, members: [duplicateEdit(c, { clearEdits: true })] }]);
        await wait(800);
        if (keyOf((await primaryOf(c, al)).primary) === pk) { steps.push(`${k}: back in Roon's own group (edit dropped)`); continue; }
      }
      await edit(c, [...(marked ? [] : [{ al: primary, members: [duplicateEdit(c, { clearBase: true })] }]), { al, members: [duplicateEdit(c, { primary: primary.oid })] }]);
      if (!marked) steps.push(`${pk}: marked the primary`);
      marked = true;
      steps.push(`${k}: grouped under ${pk}`);
    }
    log(`versions_group: ${field(primary, 'Title')} (${pk}) ← ${others.map(keyOf).join(', ')}: ${steps.join('; ')}`);
    await wait(800);
    const rows: Any[] = [];
    for (const al of others) rows.push(versionRow(c, al, await duplicateOf(c, al), keyOf((await primaryOf(c, al)).primary)));
    const ok = rows.every((r) => (r.group_primary ?? r.version_of) === pk);
    return { ok, primary: albumRow(c, primary), versions: rows, steps, note: ok ? undefined : 'Roon said ok, but not every album is in the group (version_of and group_primary say where each one is)' };
  });
}

/** One album out of its version group: first the grouping edit (if there is one), then Roon's own grouping if it still holds. */
export async function ungroupVersion(key: string) {
  return withCore(async (c) => {
    const al = await libraryAlbum(c, key);
    let d = await duplicateOf(c, al);
    if (!d.of) throw new RoonError(`"${field(al, 'Title')}" isn't a version in another album's group — if it's the primary, ungroup the other versions (roon_versions marks the group's albums grouped, its primary primary)`, 'invalid');
    const was = d.of, wasPrimary = keyOf((await primaryOf(c, al)).primary); const steps: string[] = [];
    if (d.edited) {
      await edit(c, [{ al, members: [duplicateEdit(c, { clearEdits: true })] }]);
      steps.push('dropped the grouping edit'); await wait(800); d = await duplicateOf(c, al);
    }
    if (d.of) {
      await edit(c, [{ al, members: [duplicateEdit(c, { clearBase: true })] }]);
      steps.push('overruled Roon\'s own grouping'); await wait(800); d = await duplicateOf(c, al);
    }
    log(`versions_ungroup: ${field(al, 'Title')} (${key}) out of ${was}: ${steps.join(', ')}`);
    return { ok: !d.of, album: versionRow(c, al, d), was_version_of: was, was_in_group_of: wasPrimary !== was ? wasPrimary : undefined, steps,
             note: d.of ? 'Roon said ok, but the album is still in the group' : undefined };
  });
}
