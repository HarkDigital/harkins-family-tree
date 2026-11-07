"""Photos and documents for the site: Ancestry gallery media, Ancestry record images with their
transcriptions, and uploads made from the site itself.

Ancestry's copies live in ancestry-export/media/, out of git with the rest of the export:
    catalog.json                       what each file is, who it belongs to and where it came from
    tree/<media id>.jpg                gallery photos, headstones and clippings
    records/<collection>-<image>.jpg   record images: census pages, certificates, draft cards...
    thumbs/                            480px copies the build makes with sips
Uploads from the site's editor are committed straight to docs/media/added/ and listed in
docs/media/added.json.

Refresh the Ancestry copies with tools/ancestry_pull.js and `python3 -I tools/media.py keys | unpack | import`
(see README). The build calls attach() for each page and publish() for the public copy.
"""
import base64, json, re, shutil, subprocess, sys
from collections import defaultdict
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
STORE = ROOT_DIR / "ancestry-export" / "media"
DOCS_MEDIA = ROOT_DIR / "docs" / "media"
ADDED = DOCS_MEDIA / "added.json"
THUMB = 480
TREE_ID = "168832940"  # the tree on Ancestry that tools/ancestry_pull.js reads

# Gallery pictures of people who may be living stay off the public site.
PRIVATE = {
    "12b17f45-9964-4a29-8c5d-56881ba21316",  # Dymond family, 2016
    "d502370d-7d37-4750-a41c-90c87c2eb12a",  # Glen and Peg with their children
    "16a00401-1866-4962-b294-0e62c84ae4ee",  # Peg and Glen's wedding, 1946 (Peg may be living)
    "3fc2dad7-0eee-4e26-ad84-5d59b89bedd8",  # Jean, Marjorie and Glen Jr., 1929 (H. Marjorie may be living)
    "9c40804c-a79b-4a77-8866-ea6a312587b5",  # Agnes Henwood's 1959 death notice names her living children and towns
}
# Public copies cut short, keeping this much of the picture's height from the top
PUBLIC_CROP = {
    "59869143-f394-4976-b4ba-a5d14def51a9": 0.89,  # funeral card: the funeral home's site at its foot leads to an obituary naming living family
}
SKIP ={"75d24c7f-f3c4-4e89-91ad-ff9391bef080"}  # Ancestry's "DNA verified" badge, not a picture of anyone
# Ancestry's own labels, corrected after looking at each picture
KIND = {
    "03db4c19-ea10-472d-8d40-578700d1eef2": "document",  # Wyoming Democrat clipping, 1900
    "0400d959-96ea-4feb-8788-61df04423bc6": "document",  # signature on the 1749 ship list
    "06dab443-7943-48e1-a1d9-7b0872594641": "photo",     # Dymond Mill
    "1c3eb132-0bed-40b8-8b8e-154600963958": "headstone",
    "25766768-525d-45e3-867a-60edc7ab094f": "document",  # Catherine Henwood's death certificate
    "26a12a4b-a2c2-4b53-88cd-15053f921bd6": "headstone",
    "59869143-f394-4976-b4ba-a5d14def51a9": "document",  # funeral card
    "6975fa62-01a1-47cf-95bb-194061d3166e": "headstone",
    "8d7f7dec-7c30-4e55-a28b-26ae5b32230e": "document",  # 1891 birth return index
    "9c40804c-a79b-4a77-8866-ea6a312587b5": "document",  # death notice, 1959
    "a9e7878c-b380-4300-88a9-23660b797812": "headstone",
    "b5838338-7c76-4760-ab9a-d230c81010cb": "headstone",
    "db47be4d-1037-4d07-b653-6a84184977ad": "headstone",
    "e121a382-48b9-4e0d-ac38-524e31d3d3dd": "document",  # obituary, 1903
    "f03f2dff-6a59-4dc6-bb6d-76439a16d916": "headstone",
}
# People in a picture whom Ancestry doesn't link to it
EXTRA_PEOPLE = {"2639ac76-b18a-4907-abb3-eed75d0369f7": ["@I342198784189@"]}  # Abraham Edward Henwood
# Profile pictures, with where the face sits for square crops. Ancestry marks headstones and documents
# as primary too, so only portraits are used here.
AVATARS = {
    "@I342198310990@": ("01265d18-cbf0-47ae-b79a-171de171314b", "50% 30%"),  # Wayman Ferre Dymond
    "@I342198310961@": ("2e43624e-207d-46a6-8d17-bacd07729aa6", "50% 30%"),  # Mary Louise Eggleston
    "@I342198309705@": ("3d45c052-cd7c-4017-b381-fa1b3c42a351", "50% 25%"),  # Marjorie Helen Schuler
    "@I342200255235@": ("d4121fe3-cdee-446c-a5ba-37e266c7899f", "50% 35%"),  # John Booth Dymond Sr.
    "@I342198309689@": ("e18ca479-0613-431e-86bd-3d955dfa2980", "48% 12%"),  # Glen Austin Dymond Sr.
    "@I342202235553@": ("f6273184-2599-40a4-b6a1-f18821238516", "50% 38%"),  # Abraham Henwood
    "@I342198784186@": ("2639ac76-b18a-4907-abb3-eed75d0369f7", "30% 30%"),  # Agnes Dougherty
    "@I342198784189@": ("2639ac76-b18a-4907-abb3-eed75d0369f7", "72% 22%"),  # Abraham Edward Henwood
}
# Modern address lists stay off the public site even for people who have died
PRIVATE_COLLECTIONS = {"1788", "7339"}
KIND_ORDER = {"photo": 0, "headstone": 1, "document": 2, "story": 3, "record": 4}
RECORD_TYPES = [
    (r"census", "Census"), (r"death certificate", "Death certificate"), (r"draft", "Draft card"),
    (r"marriage", "Marriage record"), (r"obituary", "Obituary index"), (r"find a grave", "Find a Grave"),
    (r"social security", "Social Security"), (r"death (index|records)|select deaths", "Death record"),
    (r"director", "Directory"), (r"passenger", "Passenger list"), (r"parish|baptism", "Parish register"),
    (r"\bland\b", "Land record"), (r"muster", "Navy muster roll"), (r"veteran", "Veteran file"),
    (r"public records", "Public records"), (r"extraction", "Irish records"),
]


def load_catalog():
    f = STORE / "catalog.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"tree": {}, "records": {}}


def load_added():
    return json.loads(ADDED.read_text(encoding="utf-8")) if ADDED.exists() else {"items": [], "avatars": {}}


def record_key(s):
    """'db:rid' from a GEDCOM _APID ('1,7602::42300688') or an Ancestry record URL, else None."""
    m = re.match(r"\d+,(\d+)::(\d+)$", s or "") or re.search(r"ancestry\.com/search/collections/(\d+)/records/(\d+)", s or "")
    return f"{m.group(1)}:{m.group(2)}" if m and m.group(2) != "0" else None


def gedcom_links(records, kids, first):
    """Who each Ancestry record and gallery item belongs to, from the parsed GEDCOM.

    Returns ({pid: {record keys}}, {pid: primary gallery media id}). Family-level citations go to both spouses.
    """
    links, primary = defaultdict(set), {}
    oid = {r["xref"]: first(r, "_OID") for r in records if r["tag"] == "OBJE"}

    def walk(n, owners):
        for c in n["children"]:
            if c["tag"] == "SOUR" and c["value"].startswith("@"):
                k = record_key(first(c, "_APID"))
                if k:
                    for o in owners:
                        links[o].add(k)
            walk(c, owners)
    for r in records:
        if r["tag"] == "INDI":
            walk(r, [r["xref"]])
            for o in kids(r, "OBJE"):
                if first(o, "_PRIM") == "Y" and oid.get(o["value"]):
                    primary[r["xref"]] = oid[o["value"]]
        elif r["tag"] == "FAM":
            walk(r, [x for x in (first(r, "HUSB"), first(r, "WIFE")) if x])
    return links, primary


def research_links(people):
    """Record keys from the research's citations, which carry Ancestry record URLs."""
    links = defaultdict(set)
    for pid, p in people.items():
        for e in p["ev"]:
            for s in e["src"]:
                k = s.get("a") or record_key(s.get("u"))
                if k:
                    links[pid].add(k)
    return links


def record_type(coll):
    for pat, label in RECORD_TYPES:
        if re.search(pat, coll or "", re.I):
            return label
    return "Record"


# the fields that date a record, best first; a birth date is the person's, not the record's
EVENT_FIELDS = [r"death", r"burial", r"marriage", r"registration", r"arrival|departure", r"military|muster",
                r"baptism|christening", r"publication|obituary", r"residence", r"census"]


def record_year(rec):
    """The year of the record's own event (a census year, a death, a registration), or None."""
    m = re.match(r"(1[5-9]\d\d|20\d\d)\b", rec.get("coll") or "")
    if m:  # "1940 United States Federal Census"
        return int(m.group(1))
    dated = [(label.lower(), re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", value)) for label, value in rec.get("fields", [])
             if re.search(r"date|year", label, re.I) and not re.search(r"birth", label, re.I)]
    for want in EVENT_FIELDS:
        for label, years in dated:
            if years and re.search(want, label):
                return int(years[0])
    return next((int(years[0]) for _, years in dated if years), None)


def thumb_name(path):
    return path.with_suffix(".jpg").name


def make_thumbs(cat):
    """480px thumbnails next to the store, made once with sips (macOS)."""
    out = STORE / "thumbs"
    out.mkdir(parents=True, exist_ok=True)
    files = [STORE / "tree" / t["file"] for t in cat["tree"].values() if t.get("file")]
    files += [STORE / "records" / r["image"] for r in cat["records"].values() if r.get("image")]
    for src in files:
        dst = out / thumb_name(src)
        if src.exists() and (not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime):
            try:
                subprocess.run(["sips", "-Z", str(THUMB), "-s", "format", "jpeg", "-s", "formatOptions", "78",
                                str(src), "--out", str(dst)], check=True, capture_output=True)
            except (OSError, subprocess.CalledProcessError) as e:
                # no sips (or it can't run here): use the full image so the page still works
                print(f"warning: couldn't make a thumbnail of {src.name} ({e}); using the full image", file=sys.stderr)
                shutil.copy2(src, dst)


def attach(people, cat, links, primary, public):
    """Give each person `photo` and `media`, and return this page's media table.

    links: {pid: {record keys}}; primary: Ancestry's primary gallery item per person. On the public page,
    gallery items and records are left out when they show or belong to anyone who may be living.
    """
    base = "media/" if public else "ancestry-export/media/"
    sub = {"tree": "p/", "records": "r/", "thumbs": "t/"} if public else {"tree": "tree/", "records": "records/", "thumbs": "thumbs/"}
    media, owners = {}, defaultdict(list)

    def ok(pids):
        return pids and not (public and any(people[p]["living"] for p in pids))

    for mid, t in cat["tree"].items():
        if mid in SKIP or (public and mid in PRIVATE):
            continue
        pids = [p for p in [f"@I{x}@" for x in t.get("pids", [])] + EXTRA_PEOPLE.get(mid, []) if p in people]
        if not ok(pids):
            continue
        key = "a-" + mid[:8]
        kind = KIND.get(mid) or t.get("kind") or "photo"
        m = {"id": key, "kind": kind, "title": t.get("title") or "", "date": t.get("date") or "",
             "place": t.get("place") or "", "desc": t.get("desc") or "", "people": pids,
             "credit": f"Shared on Ancestry by {t['by']}" if t.get("by") else "", "link": t.get("link") or "",
             "primary": [p for p in pids if primary.get(p) == mid]}
        if t.get("file"):
            m.update(src=base + sub["tree"] + t["file"], thumb=base + sub["thumbs"] + thumb_name(Path(t["file"])),
                     w=t.get("w"), h=t.get("h"), file=str(STORE / "tree" / t["file"]))
            if public and mid in PUBLIC_CROP and m["h"]:
                m["h"] = round(m["h"] * PUBLIC_CROP[mid])  # publish() makes the cut copy
        if t.get("text"):
            m["text"] = t["text"]
        media[key] = m
        for p in pids:
            owners[p].append(key)

    by_record = defaultdict(set)
    for pid, keys in links.items():
        for k in keys:
            if pid in people:
                by_record[k].add(pid)
    for k, pids in by_record.items():
        r = cat["records"].get(k)
        if not r or r.get("status") or (public and k.split(":")[0] in PRIVATE_COLLECTIONS):
            continue
        pids = sorted(pids)
        if not ok(pids):
            continue
        key = "r-" + k.replace(":", "-")
        m = {"id": key, "kind": "record", "type": record_type(r.get("coll")), "coll": r.get("coll") or "",
             "title": r.get("coll") or "", "name": r.get("name") or "", "year": record_year(r),
             "fields": r.get("fields", []), "tables": r.get("tables", []), "citation": r.get("citation") or "",
             "people": pids, "link": f"https://www.ancestry.com/search/collections/{k.replace(':', '/records/')}",
             "external": r.get("external") or "", "credit": "Ancestry.com"}
        if r.get("image"):
            m.update(src=base + sub["records"] + r["image"], thumb=base + sub["thumbs"] + thumb_name(Path(r["image"])),
                     w=r.get("w"), h=r.get("h"), file=str(STORE / "records" / r["image"]))
        media[key] = m
        for p in pids:
            owners[p].append(key)

    added = load_added()
    for u in added.get("items", []):
        pids = [p for p in u.get("people", []) if p in people]
        if not pids or any(people[p]["living"] for p in pids):
            continue  # the editor refuses these; anything that slipped through stays off both pages
        m = {**u, "people": pids}
        if not public:
            for f in ("src", "thumb"):
                if m.get(f):
                    m[f] = "docs/" + m[f]
        media[u["id"]] = m
        for p in pids:
            owners[p].append(u["id"])

    def order(mid):
        m = media[mid]
        return (KIND_ORDER.get(m["kind"], 9), 0 if m.get("primary") else 1, m.get("year") or 9999, m.get("title") or "")
    for pid, p in people.items():
        mine = sorted(set(owners.get(pid, [])), key=order)
        p["media"] = mine
        av = added.get("avatars", {}).get(pid)
        if av in media and av in mine:
            p["photo"], p["photoPos"] = av, media[av].get("pos") or "50% 30%"
        elif pid in AVATARS and "a-" + AVATARS[pid][0][:8] in media:
            p["photo"] = "a-" + AVATARS[pid][0][:8]
            p["photoPos"] = AVATARS[pid][1]
        else:
            p["photo"] = None
        for e in p["ev"]:
            for s in e["src"]:
                k = s.get("a") or record_key(s.get("u"))
                if k and "r-" + k.replace(":", "-") in mine:
                    s["m"] = "r-" + k.replace(":", "-")
    return media


def publish(media):
    """Copy the public page's Ancestry files into docs/media/ and drop any that are no longer public."""
    want = {}
    for m in media.values():
        if m.get("file") and m.get("src", "").startswith("media/"):
            src = Path(m["file"])
            want[DOCS_MEDIA / m["src"][len("media/"):]] = src
            want[DOCS_MEDIA / m["thumb"][len("media/"):]] = STORE / "thumbs" / thumb_name(src)
    for dst, src in want.items():
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.stem in PUBLIC_CROP:
            crop_top(src, dst, PUBLIC_CROP[src.stem])
        elif not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dst)
    for d in ("p", "r", "t"):
        for f in (DOCS_MEDIA / d).glob("*") if (DOCS_MEDIA / d).exists() else []:
            if f not in want:
                f.unlink()
    return len(want)


def crop_top(src, dst, keep):
    """Write the top `keep` of an image's height to dst with sips (macOS). No fallback: the cut part mustn't go out."""
    size = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(src)],
                          check=True, capture_output=True, text=True).stdout
    w, h = (int(re.search(rf"{k}: (\d+)", size).group(1)) for k in ("pixelWidth", "pixelHeight"))
    # sips takes an offset of 0 to mean "centered", so start one row down
    subprocess.run(["sips", "-c", str(round(h * keep)), str(w), "--cropOffset", "1", "0", str(src), "--out", str(dst)],
                   check=True, capture_output=True)


# Record fields that name relatives, with how many years after the cutoff the record's own person can be born
# before the relative might be living: parents are older, a husband, wife, brother or sister is born within
# about 20 years of them, and children within about 60.
RELATIVE_FIELDS = [
    (re.compile(r"^(father|mother|father's name|mother's name|parents?)$", re.I), 10),
    (re.compile(r"^(spouse|spouse's name|inferred spouse|siblings?|brothers?|sisters?)$", re.I), -20),
    (re.compile(r"^(child|children|next of kin|household members?|relatives?|informant|survived by)$", re.I), -60),
]
STREET_FIELDS = re.compile(r"street|house number|address", re.I)
RESIDENCE_FIELDS = re.compile(r"residence|home in", re.I)
DEATH_TYPES = {"Death certificate", "Death record", "Obituary index", "Social Security", "Find a Grave"}
NAME_NOISE = {"jr", "sr", "junior", "senior", "ii", "iii", "mr", "mrs", "ms", "miss", "dr", "rev"}
HIDDEN = "Not shown: may name people who are still living"


def name_tokens(name):
    return [t for t in re.sub(r"[^\w\s]", " ", (name or "").lower()).split() if t not in NAME_NOISE]


def redact_public(media, people, cutoff):
    """Keep living relatives' details out of the public copies of records.

    `people` is the full local tree. Household members who may be living are dropped, fields naming
    relatives who could be living are hidden unless they name someone known to have died, and a scan
    stays off the public site whenever its transcription needed any of that, since the image shows the
    same details. A record that is about someone who may be living (a draft card filed under the
    draftee's father, say) is left out. Returns the ids of the records that changed and of those left out.
    """
    known = []  # (given names, surname, birth year, living), with wives under their married names too
    for p in people.values():
        t = name_tokens(p["name"])
        if len(t) < 2:
            continue
        surnames = {t[-1]}
        if p["sex"] == "F":
            surnames |= {name_tokens(people[f["spouse"]]["name"])[-1] for f in p.get("fams", [])
                         if f.get("spouse") in people and name_tokens(people[f["spouse"]]["name"])}
        known += [(set(t[:-1]), sn, p.get("by"), p["living"]) for sn in surnames]

    def only_dead(name, born=None):
        """True when the name is one person and fits only people in the tree who have died."""
        t = name_tokens(name)
        if not 2 <= len(t) <= 4:
            return False
        hits = [living for given, surname, by, living in known
                if surname == t[-1] and set(t[:-1]) <= given and (born is None or by is None or abs(by - born) <= 3)]
        return bool(hits) and not any(hits)

    def may_be_living(name, born, year):
        # born more than a hundred years ago (or listed in a record that old) can't be living by the site's rule
        when = born if born is not None else year
        return (when is None or when > cutoff - 2) and not only_dead(name, born)

    def spouse_living(pid):
        return any(f.get("spouse") in people and people[f["spouse"]]["living"] for f in people[pid].get("fams", []))

    def latest(m):
        """The record's year, or the last year its collection covers when it has none (None if open-ended)."""
        coll = m.get("coll") or ""
        years = [int(y) for y in re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", coll)]
        return None if not years or re.search(r"current|present", coll, re.I) else max(years)

    # records sharing one scan (a census page, a death certificate indexed under each parent) share its year
    file_year = {}
    for m in media.values():
        if m.get("kind") == "record" and m.get("file") and m.get("year"):
            file_year[m["file"]] = max(m["year"], file_year.get(m["file"], 0))

    changed, gone, withheld = [], [], set()
    for m in media.values():
        if m.get("kind") != "record":
            continue
        year = m.get("year") or file_year.get(m.get("file"))
        last = year or latest(m)
        recent = last is None or last >= cutoff
        births = [people[p]["by"] for p in m.get("people", []) if p in people and people[p].get("by")]
        born = max(births) if births else None  # the youngest person the record is about
        dropped = hidden = 0
        about_living = False
        tables = []
        for table in m.get("tables") or []:
            keep = [list(table[0])]
            age = next((i for i, h in enumerate(table[0]) if h.strip().lower() == "age"), None)
            rel = next((i for i, h in enumerate(table[0]) if "relation" in h.lower()), None)
            for row in table[1:]:
                a, row_born = row[age].strip() if age is not None and age < len(row) else "", None
                if year and re.fullmatch(r"\d+/\d+", a):
                    row_born = year  # under a year old
                elif year and re.match(r"\d+", a):
                    row_born = year - int(re.match(r"\d+", a).group())
                if may_be_living(row[0], row_born, last):
                    dropped += 1
                    about_living |= rel is not None and rel < len(row) and row[rel].strip().lower().startswith("self")
                else:
                    keep.append(list(row))
            if len(keep) > 1:
                tables.append(keep)
        if about_living:
            gone.append(m["id"])
            if m.get("file"):
                withheld.add(m["file"])
            continue
        fields = []
        for label, value in m.get("fields") or []:
            gap = next((g for rx, g in RELATIVE_FIELDS if rx.match(label.strip())), None)
            if recent and gap is not None and not value.strip().isdigit() \
                    and (born is None or born > cutoff + gap) and not only_dead(value):
                fields.append([label, HIDDEN])
                hidden += 1
            else:
                fields.append([label, value])
        # a recent death of someone whose husband or wife is alive would give away where that person lives
        if recent and m.get("type") in DEATH_TYPES and any(spouse_living(p) for p in m.get("people", []) if p in people):
            for f in fields:
                if RESIDENCE_FIELDS.search(f[0]) or STREET_FIELDS.search(f[0]):
                    f[1] = "Not shown"
                    hidden += 1
        if not dropped and not hidden:
            continue
        for f in fields:
            if STREET_FIELDS.search(f[0]):
                f[1] = "Not shown"
        if dropped:
            fields.append(["Note", "Household members who may still be living are left out."])
        m["fields"], m["tables"] = fields, tables
        if m.get("file"):
            withheld.add(m["file"])
        changed.append(m["id"])
    for mid in gone:
        del media[mid]
    # one scan can serve several records, so withhold it from all of them
    for m in media.values():
        if m.get("file") in withheld:
            for f in ("src", "thumb", "w", "h", "file"):
                m.pop(f, None)
            m["withheld"] = True  # the viewer says why there's no scan
            if m["id"] not in changed:
                changed.append(m["id"])
    # a photo or document dated in the last hundred years (or not at all) is usually dated and placed by
    # whoever scanned or uploaded it, which can be a living relative's town
    for m in media.values():
        if m.get("kind") in ("photo", "document") and m.get("place"):
            y = re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", m.get("date") or "")
            if not y or int(y[0]) >= cutoff:
                m["place"] = ""
    # flag anything that still names a living person (unless someone who died has the same name), for a look
    living = {" ".join(t) for t in (name_tokens(p["name"]) for p in people.values() if p["living"]) if len(t) >= 2
              and not any(not alive and sn == t[-1] and set(t[:-1]) <= given for given, sn, _, alive in known)}
    for m in media.values():
        text = [m.get("desc") or "", m.get("text") or "", m.get("title") or ""]
        text += [v for _, v in m.get("fields") or []] + [c for t in m.get("tables") or [] for row in t[1:] for c in row]
        flat = " " + " ".join(name_tokens(" ".join(text))) + " "
        for name in sorted(n for n in living if f" {n} " in flat):
            print(f"warning: public {m['id']} names {name}, who may be living", file=sys.stderr)
    return changed, gone


URL = re.compile(r"https?://[^\s\"'<>]+")
# pages that list survivors: obituaries, death notices and grave memorials
SURVIVOR_PAGES = re.compile(r"newspapers\.com|findagrave\.com|legacy\.com|obituar|death notice|funeral|\bdies\b|-dies\b", re.I)


def public_links(pub, people, media, changed, gone, cutoff):
    """Take links off the public page where they lead to what it leaves out.

    A trimmed record keeps no link to the full one, and nothing cites it with one. Obituaries and grave
    memorials of anyone who died in the last hundred years (or whose death isn't dated) are cited without
    links, since they can list survivors who are still living.
    """
    def recent_death(pid):
        p = people.get(pid)
        return bool(p) and not p["living"] and not (p.get("dy") and p["dy"] < cutoff)

    def unlink(text, only=None):
        return URL.sub(lambda u: "" if only is None or only.search(u.group()) else u.group(), text or "").strip()

    key = lambda mid: ":".join(mid[2:].split("-", 1))
    touched = set(changed) | set(gone)
    touched_keys = {key(m) for m in touched}
    for m in media.values():
        if m.get("kind") != "record":
            continue
        if m["id"] in changed:
            m.pop("link", None)
            m.pop("external", None)
            m["citation"] = unlink(m.get("citation"))
        elif (m.get("year") or 0) >= cutoff or (not m.get("year") and any(recent_death(p) for p in m.get("people", []))):
            for f in ("link", "external"):
                if SURVIVOR_PAGES.search(m.get(f) or ""):
                    m.pop(f)
            m["citation"] = unlink(m.get("citation"), SURVIVOR_PAGES)
            m["fields"] = [[k, v] for k, v in m.get("fields") or [] if not (URL.search(v) and SURVIVOR_PAGES.search(v))]
    for pid, p in pub.items():
        risky = recent_death(pid)
        for e in p.get("ev", []):
            for s in e.get("src", []):
                text = " ".join(s.get(f) or "" for f in ("t", "p", "u"))
                if s.get("a") in touched_keys or s.get("m") in touched or (risky and SURVIVOR_PAGES.search(text)):
                    s.pop("u", None)
                    s["p"] = unlink(s.get("p"))
                if s.get("m") in gone:
                    s.pop("m")


def strip(media):
    """The page doesn't need local file paths."""
    return {k: {f: v for f, v in m.items() if f != "file"} for k, m in media.items()}


# ---------------------------------------------------------------- import a fresh pull from Ancestry

def import_pull(pull):
    """Copy a pull made through the browser into the store.

    <pull>/photos/<media id>.jpg with meta-<media id>.json, <pull>/records/<db>-<image>.jpg with
    meta-<db>-<image>.json, <pull>/records.json ({"db:rid": record}) and optionally <pull>/stories.json.
    """
    pull = Path(pull)
    cat = load_catalog()
    (STORE / "tree").mkdir(parents=True, exist_ok=True)
    (STORE / "records").mkdir(parents=True, exist_ok=True)
    for meta in sorted((pull / "photos").glob("meta-*.json")):
        x = json.loads(meta.read_text())
        mid, m = x["id"], x["meta"]
        src = pull / "photos" / f"{mid}.jpg"
        shutil.copy2(src, STORE / "tree" / src.name)
        sub = (m.get("sub") or m.get("cat") or "").lower()
        cat["tree"][mid] = {
            "title": m.get("title", ""), "kind": {"headstone": "headstone", "document": "document"}.get(sub, "photo"),
            "date": "" if (m.get("date") or "").lower() == "unknown" else m.get("date", ""),
            "place": m.get("loc", ""), "desc": (m.get("desc") or "").replace("\r\n", "\n").strip(),
            "by": m.get("by", ""), "link": m.get("originWeb", ""), "pids": m.get("pids", [m.get("pid")]),
            "file": src.name, "w": x["w"], "h": x["h"]}
    stories = pull / "stories.json"
    for mid, s in (json.loads(stories.read_text()) if stories.exists() else {}).items():
        cat["tree"][mid] = {**cat["tree"].get(mid, {}), **s, "kind": "story"}
    images = {}
    for meta in sorted((pull / "records").glob("meta-*.json")):
        x = json.loads(meta.read_text())
        src = pull / "records" / f"{x['id']}.jpg"
        shutil.copy2(src, STORE / "records" / src.name)
        images[x["imgKey"]] = (src.name, x["w"], x["h"])
    for k, r in json.loads((pull / "records.json").read_text()).items():
        rec = {f: r.get(f) for f in ("coll", "name", "url", "fields", "tables", "citation", "external", "status") if r.get(f)}
        if r.get("imageKey") in images:
            rec["image"], rec["w"], rec["h"] = images[r["imageKey"]]
        cat["records"][k] = rec
    (STORE / "catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(cat['tree'])} gallery items, {len(cat['records'])} records "
          f"({sum(1 for r in cat['records'].values() if r.get('image'))} with images) -> {STORE}")


def pull_keys():
    """What tools/ancestry_pull.js should fetch: everyone in the latest export and every record they cite."""
    import contextlib
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_tree
    ged = max((ROOT_DIR / "ancestry-export").glob("*.ged"), key=lambda p: p.stat().st_mtime)
    with contextlib.redirect_stdout(sys.stderr):  # keep the build's notes out of the JSON
        people, _, _ = build_tree.build(ged)
    glinks, _ = gedcom_links(build_tree.parse(ged), build_tree.kids, build_tree.first)
    records = set()
    for found in (glinks, research_links(people)):
        for keys in found.values():
            records |= keys
    return {"tree": TREE_ID, "people": sorted(pid[2:-1] for pid in people if re.fullmatch(r"@I\d+@", pid)),
            "records": sorted(records)}


def unpack(pull, parts):
    """Turn the parts ancestry_pull.js handed back (saved tool results) into a pull folder for import_pull()."""
    pull = Path(pull)
    for sub in ("photos", "records"):
        (pull / sub).mkdir(parents=True, exist_ok=True)
    n = 0
    for f in parts:
        text = Path(f).read_text(encoding="utf-8")
        try:  # a saved tool result is [{"type": "text", "text": "<the page's string, JSON-quoted>"}]
            outer = json.loads(text)
            text = outer[0]["text"] if isinstance(outer, list) else text
        except ValueError:
            pass
        val, _ = json.JSONDecoder().raw_decode(text.strip())
        part = json.loads(val) if isinstance(val, str) else val
        if not isinstance(part, dict) or part.get("hft") != 1:
            sys.exit(f"{f}: not a part from ancestry_pull.js")
        for it in part["files"]:
            data = base64.b64decode(it.pop("b64"))
            if it.get("folder") not in ("photos", "records") or not re.fullmatch(r"[A-Za-z0-9_.-]+", it.get("id", "")):
                sys.exit(f"{f}: unexpected file {it.get('folder')}/{it.get('id')}")
            if data[:3] != b"\xff\xd8\xff" or len(data) != it.get("bytes"):
                sys.exit(f"{f}: {it['id']} isn't a complete JPEG")
            (pull / it["folder"] / f"{it['id']}.jpg").write_bytes(data)
            (pull / it["folder"] / f"meta-{it['id']}.json").write_text(json.dumps(it, ensure_ascii=False, indent=1),
                                                                       encoding="utf-8")
            n += 1
        for name, key in (("records.json", "records"), ("stories.json", "stories")):
            if key in part:
                (pull / name).write_text(json.dumps(part[key], ensure_ascii=False, indent=1), encoding="utf-8")
        if part.get("errors"):
            print("Ancestry errors:", json.dumps(part["errors"], indent=1), file=sys.stderr)
    print(f"{n} files -> {pull}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "keys" and len(sys.argv) == 2:
        print(json.dumps(pull_keys()))
    elif cmd == "unpack" and len(sys.argv) >= 4:
        unpack(sys.argv[2], sys.argv[3:])
    elif cmd == "import" and len(sys.argv) == 3:
        import_pull(sys.argv[2])
    else:
        sys.exit("usage: python3 -I tools/media.py keys | unpack <pull dir> <part files...> | import <pull dir>")
