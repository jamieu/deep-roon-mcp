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
import { withCore, RoonError } from '../core/session';
import { log } from '../core/log';
import { Any, C, albumRow, field, obj, short, untilLoaded, wait } from './graph';
import { findAlbum, performer } from './library';

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
// René's findAlbum, whose wait for an album Roon hasn't loaded lately is longer since 29 Oct 2026 (Personal History
// 2109487 and Benita, Time for a Change 2634543 failed at 4 s and worked on the next call). Only albums in the library
// (Source 1) have edit layers.
const inLibrary = (al: Any) => field(al, 'Source') === 1;
async function libraryAlbum(c: C, key: string): Promise<Any> {
  const al = await findAlbum(c, key);
  if (!inLibrary(al)) throw new RoonError(`"${field(al, 'Title')}" (${key}) isn't in the library — roon_library_add first`, 'invalid');
  return al;
}
async function libraryAlbums(c: C, keys: string[]): Promise<Any[]> {
  const albums: Any[] = [];
  for (const k of keys) albums.push(await libraryAlbum(c, k));
  return albums;
}
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
 *  so the first link isn't always the primary. `via`: the albums passed on the way, the primary last. `outside`: the
 *  chain reached an album that isn't in the library (no edit layers to follow), or one Roon no longer knows; `key` is
 *  then that album's, and `primary` the album if Roon sent it. */
async function primaryOf(c: C, al: Any): Promise<{ primary?: Any; key: string; via: string[]; outside?: boolean }> {
  const via: string[] = [];
  let cur = al;
  for (let i = 0; i < 10; i++) {
    const d = await duplicateOf(c, cur);
    if (!d.of || d.of === keyOf(cur) || via.includes(d.of)) break;
    via.push(d.of);
    const next = d.parent && field(d.parent, 'Title') !== undefined ? d.parent : await findAlbum(c, d.of).catch(() => undefined);
    if (!next || !inLibrary(next)) return { primary: next, key: d.of, via, outside: true };
    cur = next;
  }
  return { primary: cur, key: keyOf(cur), via };
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
 *  "make that one the first key"), and the answer says so (`primary_kept`); switching a group's primary isn't done here.
 *  An album whose own group leads out of the library is simply grouped here. An album that was taken out of a group
 *  Roon made goes back by dropping that edit, so Roon's own grouping holds again; otherwise DuplicateOf points at the
 *  primary, and the primary is marked a duplicate of nothing — both as Roon's own Edit › Group alternate versions writes
 *  them (measured 29 Oct 2026 on Yowzers/Yowsers: EditValue on the lesser copy, ClearBaseValue on the primary). */
export async function groupVersions(keys: string[]) {
  return withCore(async (c) => {
    const unique = [...new Set(keys.map((k) => k.trim()))];
    if (unique.length < 2) throw new RoonError('Two or more album keys: the first becomes the primary version', 'invalid');
    const albums = await libraryAlbums(c, unique);
    const steps: string[] = [];
    const first = await primaryOf(c, albums[0]);
    if (first.outside) throw new RoonError(`${unique[0]} is a version in the group of ${first.key}, which isn't in the library — put another key first, or take ${unique[0]} out of that group (roon_versions_ungroup)`, 'invalid');
    const primary = first.primary, pk = first.key, kept = pk !== unique[0];
    if (kept) steps.push(`${unique[0]} is already a version in the group of ${pk}${first.via.length > 1 ? ` (via ${first.via.slice(0, -1).join(', ')})` : ''}, so ${pk} stays the primary`);
    let marked = (await duplicateOf(c, primary)).primary;
    const others = albums.filter((al, i) => keyOf(al) !== pk && albums.findIndex((x) => keyOf(x) === keyOf(al)) === i);
    for (const al of others) {
      const k = keyOf(al);
      if ((await primaryOf(c, al)).key === pk) { if (k !== unique[0]) steps.push(`${k}: already in the group`); continue; }
      if ((await duplicateOf(c, al)).edited) {
        await edit(c, [{ al, members: [duplicateEdit(c, { clearEdits: true })] }]);
        await wait(800);
        if ((await primaryOf(c, al)).key === pk) { steps.push(`${k}: back in Roon's own group (edit dropped)`); continue; }
      }
      await edit(c, [...(marked ? [] : [{ al: primary, members: [duplicateEdit(c, { clearBase: true })] }]), { al, members: [duplicateEdit(c, { primary: primary.oid })] }]);
      if (!marked) steps.push(`${pk}: marked the primary`);
      marked = true;
      steps.push(`${k}: grouped under ${pk}`);
    }
    log(`versions_group: ${field(primary, 'Title')} (${pk}) ← ${others.map(keyOf).join(', ')}: ${steps.join('; ')}`);
    await wait(800);
    const rows: Any[] = [];
    for (const al of others) rows.push(versionRow(c, al, await duplicateOf(c, al), (await primaryOf(c, al)).key));
    const ok = rows.every((r) => (r.group_primary ?? r.version_of) === pk);
    const notes = [ok ? '' : 'Roon said ok, but not every album is in the group (version_of and group_primary say where each one is)',
      kept ? `${unique[0]} was already a version in the group of ${pk}, so ${pk} stayed the primary, not ${unique[0]}` : ''].filter(Boolean);
    return { ok, primary: albumRow(c, primary), primary_kept: kept || undefined, requested_primary: kept ? unique[0] : undefined, versions: rows, steps,
             note: notes.join('. ') || undefined };
  });
}

/** One album out of its version group: first the grouping edit (if there is one), then Roon's own grouping if it still holds. */
export async function ungroupVersion(key: string) {
  return withCore(async (c) => {
    const al = await libraryAlbum(c, key);
    let d = await duplicateOf(c, al);
    if (!d.of) throw new RoonError(`"${field(al, 'Title')}" isn't a version in another album's group — if it's the primary, ungroup the other versions (roon_versions marks the group's albums grouped, its primary primary)`, 'invalid');
    const was = d.of, wasPrimary = (await primaryOf(c, al)).key; const steps: string[] = [];
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
