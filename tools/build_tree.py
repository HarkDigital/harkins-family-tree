"""Build family-tree.html from an Ancestry GEDCOM export.

Usage: python3 -I tools/build_tree.py [path/to/export.ged]
Defaults to the newest .ged under ancestry-export/. Web research in tools/research.py is layered over
the export. Writes the full family-tree.html next to tools/ (kept out of git) and the public
docs/index.html served by GitHub Pages, where people who may be living show only their names and
relationships.
"""
import json, re, sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import research

ROOT_DIR = Path(__file__).resolve().parent.parent
ROOT_PERSON = "@I342194601801@"  # Michael Christopher Harkins
LIVING_CUTOFF = date.today().year - 100  # no death record and born this year or later: treat as living
NOT_CONNECTED = "Not connected to your family"

# ---------------------------------------------------------------- parse GEDCOM

def parse(path):
    records, stack = [], []
    for raw in Path(path).read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"^(\d+)\s+(@[^@]+@\s+)?(\S+)\s?(.*)$", raw)
        if not m:
            continue
        level = int(m.group(1))
        node = {"tag": m.group(3), "xref": (m.group(2) or "").strip() or None,
                "value": m.group(4), "children": []}
        while stack and stack[-1][0] >= level:
            stack.pop()
        (records if level == 0 else stack[-1][1]["children"]).append(node)
        stack.append((level, node))
    return records


def kids(n, tag):
    return [c for c in n["children"] if c["tag"] == tag]


def first(n, tag):
    k = kids(n, tag)
    return k[0]["value"] if k else None


def text(n):
    v = n["value"]
    for c in n["children"]:
        if c["tag"] == "CONT":
            v += "\n" + c["value"]
        elif c["tag"] == "CONC":
            v += c["value"]
    return v


EVENT_LABELS = {
    "BIRT": "Born", "CHR": "Christened", "BAPM": "Baptized", "DEAT": "Died", "BURI": "Buried",
    "CREM": "Cremated", "MARR": "Married", "DIV": "Divorced", "RESI": "Lived", "OCCU": "Occupation",
    "IMMI": "Immigrated", "EMIG": "Emigrated", "NATU": "Naturalized", "CENS": "Census",
    "MILI": "Military service", "_MILT": "Military service", "RELI": "Religion", "EDUC": "Education",
    "PROB": "Probate", "WILL": "Will", "RETI": "Retired", "ARRI": "Arrived", "DEPA": "Departed",
    "TITL": "Title", "NATI": "Nationality", "DSCR": "Description", "ENGA": "Engaged", "EVEN": "Event",
}
EVEN_LABELS = {"Arrival": "Arrived", "Departure": "Departed"}


def load(path):
    records = parse(path)
    sources = {r["xref"]: first(r, "TITL") or r["xref"] for r in records if r["tag"] == "SOUR"}

    def event(n):
        label = EVENT_LABELS.get(n["tag"], n["tag"].title())
        typ = first(n, "TYPE")
        if n["tag"] == "EVEN" and typ:
            label = EVEN_LABELS.get(typ, typ)
        notes = [text(c) for c in kids(n, "NOTE")]
        cites = []
        for s in kids(n, "SOUR"):
            title = sources.get(s["value"], s["value"])
            if title not in [c["t"] for c in cites]:
                cites.append({"t": title, "p": (first(s, "PAGE") or "")[:220]})
        return {"tag": n["tag"], "label": label, "date": first(n, "DATE") or "",
                "place": first(n, "PLAC") or "",
                "detail": "; ".join(x for x in [n["value"], *notes] if x),
                "src": cites}

    people, families = {}, {}
    for r in records:
        if r["tag"] == "INDI":
            names = [nm["value"].replace("/", "").strip() for nm in kids(r, "NAME")]
            names = [re.sub(r"\s+", " ", n) for n in names]
            surn = first(kids(r, "NAME")[0], "SURN") if kids(r, "NAME") else None
            allsrc = set()

            def walk(n):
                for c in n["children"]:
                    if c["tag"] == "SOUR" and c["value"].startswith("@"):
                        allsrc.add(c["value"])
                    walk(c)
            walk(r)
            people[r["xref"]] = {
                "id": r["xref"], "name": names[0] if names else "(unknown)", "surname": surn or "",
                "sex": first(r, "SEX") or "U",
                "famc": [c["value"] for c in kids(r, "FAMC")],
                "fams": [c["value"] for c in kids(r, "FAMS")],
                "events": [event(c) for c in r["children"] if c["tag"] in EVENT_LABELS],
                "nsrc": len(allsrc),
            }
        elif r["tag"] == "FAM":
            families[r["xref"]] = {
                "husb": first(r, "HUSB"), "wife": first(r, "WIFE"),
                "chil": [c["value"] for c in kids(r, "CHIL")],
                "events": [event(c) for c in r["children"] if c["tag"] in EVENT_LABELS],
            }
    return people, families

# ---------------------------------------------------------------- derived data

def year(s):
    m = re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", s or "")
    return int(m[0]) if m else None


def short_place(place):
    drop = {"usa", "united states", "united states of america", "united kingdom", "u.s.a."}
    parts = [p.strip() for p in (place or "").split(",") if p.strip()]
    parts = [p for p in parts if p.lower() not in drop]
    dedup = []
    for p in parts:
        if not dedup or dedup[-1].lower() != p.lower():
            dedup.append(p)
    if len(dedup) >= 2:
        return f"{dedup[0]}, {dedup[-1]}"
    return dedup[0] if dedup else ""


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def word(sex, male, female, either):
    return male if sex == "M" else female if sex == "F" else either


def direct_label(gen, sex):
    if gen == 0:
        return "You"
    if gen == 1:
        return word(sex, "Father", "Mother", "Parent")
    base = word(sex, "grandfather", "grandmother", "grandparent")
    if gen == 2:
        return base.capitalize()
    if gen == 3:
        return "Great-" + base
    return f"{ordinal(gen - 2)} great-{base}"


def build(path):
    people, families = load(path)
    for w in research.apply(people, families, EVENT_LABELS):
        print("research:", w)

    def parents(pid):
        p = people[pid]
        f = families.get(p["famc"][0]) if p["famc"] else None
        return (f["husb"], f["wife"]) if f else (None, None)

    # ahnentafel numbering of the direct line
    ahn, queue = {1: ROOT_PERSON}, [1]
    while queue:
        n = queue.pop(0)
        fa, mo = parents(ahn[n])
        if fa:
            ahn[2 * n] = fa
            queue.append(2 * n)
        if mo:
            ahn[2 * n + 1] = mo
            queue.append(2 * n + 1)
    num_of = {pid: n for n, pid in ahn.items()}
    line_names = {4: "harkins", 5: "perret", 6: "dymond", 7: "henwood"}

    def line_of(n):
        gen = n.bit_length() - 1
        if gen < 2:
            return "self"
        return line_names[n >> (gen - 2)]

    # nearest direct ancestor for everyone else (walking up through parents)
    def nearest_direct(pid):
        frontier, depth, seen = [pid], 0, {pid}
        while frontier:
            depth += 1
            nxt = []
            for x in frontier:
                for par in parents(x):
                    if par and par not in seen:
                        if par in num_of:
                            return par, depth
                        seen.add(par)
                        nxt.append(par)
            frontier = nxt
        return None, None

    # connectivity, to spot people hanging loose in the tree
    adj = defaultdict(set)
    for f in families.values():
        mem = [x for x in [f["husb"], f["wife"], *f["chil"]] if x]
        for a in mem:
            adj[a].update(m for m in mem if m != a)
    connected, stack = {ROOT_PERSON}, [ROOT_PERSON]
    while stack:
        for nb in adj[stack.pop()]:
            if nb not in connected:
                connected.add(nb)
                stack.append(nb)

    # who may still be living; undated people borrow an estimate from dated parents, spouses,
    # siblings and children, and anyone still unknown counts as living to be safe
    est = {pid: year(next((e["date"] for e in p["events"] if e["tag"] == "BIRT"), "")) for pid, p in people.items()}
    for _ in range(4):
        for pid, p in people.items():
            if est[pid]:
                continue
            guesses = [est[x] + 25 for x in parents(pid) if x and est.get(x)]
            for fid in p["fams"]:
                f = families.get(fid, {"husb": None, "wife": None, "chil": []})
                guesses += [est[x] for x in (f["husb"], f["wife"]) if x and x != pid and est.get(x)]
                guesses += [est[c] - 25 for c in f["chil"] if est.get(c)]
            if p["famc"] and p["famc"][0] in families:
                guesses += [est[c] for c in families[p["famc"][0]]["chil"] if c != pid and est.get(c)]
            est[pid] = max(guesses, default=None)
    living = {pid for pid, p in people.items()
              if not any(e["tag"] in ("DEAT", "BURI", "CREM") for e in p["events"])
              and (est[pid] is None or est[pid] >= LIVING_CUTOFF)}

    out = {}
    for pid, p in people.items():
        # an undated departure belongs just before the arrival it led to
        arrival = next((year(e["date"]) for e in p["events"] if e["label"] == "Arrived" and year(e["date"])), None)
        evs = sorted(p["events"], key=lambda e: (
            0 if e["tag"] in ("BIRT", "CHR", "BAPM") else 2 if e["tag"] in ("DEAT", "BURI", "CREM") else 1,
            year(e["date"]) or (arrival - 0.5 if e["label"] == "Departed" and arrival else 9999)))
        birth = next((e for e in evs if e["tag"] == "BIRT"), None)
        death = next((e for e in evs if e["tag"] == "DEAT"), None)
        fa, mo = parents(pid)
        fams = []
        for fid in p["fams"]:
            f = families.get(fid)
            if not f:
                continue
            spouse = f["wife"] if f["husb"] == pid else f["husb"]
            marr = next((e for e in f["events"] if e["tag"] == "MARR"), None)
            fams.append({"spouse": spouse, "kids": f["chil"],
                         "marr": " · ".join(x for x in [marr["date"], short_place(marr["place"])] if x) if marr else ""})
        sibs = []
        if p["famc"] and p["famc"][0] in families:
            sibs = [c for c in families[p["famc"][0]]["chil"] if c != pid]

        if pid in num_of:
            n = num_of[pid]
            gen = n.bit_length() - 1
            rel, line = direct_label(gen, p["sex"]), line_of(n)
        else:
            n, gen = None, None
            anc, k = nearest_direct(pid)
            if anc:
                g = num_of[anc].bit_length() - 1
                line = line_of(num_of[anc])
                sex = p["sex"]
                if k == 1 and g == 1:
                    rel = word(sex, "Brother", "Sister", "Sibling")
                elif k == 1 and g == 2:
                    rel = word(sex, "Uncle", "Aunt", "Aunt or uncle")
                elif k == 1:
                    rel = ("Great-" if g == 3 else f"{ordinal(g - 2)} great-") + word(sex, "uncle", "aunt", "aunt or uncle")
                elif g == 1 and k == 2:
                    rel = word(sex, "Nephew", "Niece", "Niece or nephew")
                elif k >= 2 and g >= 2:
                    degree, removed = min(k, g) - 1, abs(k - g)
                    rel = f"{ordinal(degree)} cousin" + (f", {removed}× removed" if removed else "")
                else:
                    rel = "Relative"
            else:
                spouse_rel = next((f["spouse"] for f in fams if f["spouse"] in num_of or f["spouse"] in connected), None)
                if pid not in connected:
                    rel, line = NOT_CONNECTED, "none"
                elif spouse_rel:
                    rel = word(p["sex"], "Husband", "Wife", "Spouse") + " of " + people[spouse_rel]["name"]
                    line = None  # filled below from the spouse
                else:
                    rel, line = "Relative by marriage", "none"
        out[pid] = {
            "id": pid, "name": p["name"],
            "surname": re.sub(r"^\(.*?\)\s*", "", p["surname"] or p["name"].split()[-1]),
            "sex": p["sex"],
            "by": year(birth["date"]) if birth else None, "dy": year(death["date"]) if death else None,
            "bp": short_place(birth["place"]) if birth else "",
            "father": fa, "mother": mo, "fams": fams, "sibs": sibs,
            "ahn": n, "gen": gen, "rel": rel, "line": line,
            "nsrc": p["nsrc"], "ev": evs, "living": pid in living,
        }
    for pid, o in out.items():
        if o["line"] is None:
            sp = next((f["spouse"] for f in o["fams"] if f["spouse"] in out), None)
            o["line"] = out[sp]["line"] if sp and out[sp]["line"] not in (None,) else "none"

    direct = [pid for pid in num_of if pid != ROOT_PERSON]
    stats = {
        "people": len(people),
        "direct": len(direct),
        "generations": max(n.bit_length() - 1 for n in ahn),
        "earliest": min((out[p]["by"] for p in direct if out[p]["by"]), default=None),
        "unsourced": sum(1 for p in direct if people[p]["nsrc"] == 0),
        "export_date": "",
        "research_date": research.DATE,
    }
    head = Path(path).read_text(encoding="utf-8-sig")[:2000]
    m = re.search(r"^1 DATE (.+)$", head, re.M)
    stats["export_date"] = m.group(1).strip() if m else ""
    return out, stats, ROOT_PERSON


# ---------------------------------------------------------------- curated notes
# Written by reviewing the 6 Nov 2026 export and updated with that day's research (tools/research.py).
# Person ids are Ancestry's and survive re-exports; ids starting @R are people the research added.

LINES = [
    {"key": "harkins", "title": "Harkins", "who": "@I342194601955@",
     "origins": ["Philadelphia", "Ireland"],
     "story": "The Harkinses were Philadelphians. Thomas M. Harkins (1888–1943) was the son of William Harkins "
              "(1859–1938) and his first wife Anna, and William's parents, William Harkins and Anna Regent, "
              "were born in the city too. In 1900 Thomas was living with his father, his sister Mary and his "
              "brothers George and Phillip on Stampers Lane in South Philadelphia; by 1910 William had "
              "remarried, to Katherine Garrity. Thomas worked as an engineer for a stevedoring firm and married "
              "Helen Morley in 1913. Helen's parents, James and Mary Morley, were both born in Ireland; James came "
              "over in 1871, and in 1900 he was a laborer on Manton Street with Helen and her brothers. Thomas "
              "Jr. grew up in Philadelphia's 36th Ward, served in World War II and died in Cherry Hill in 2003. "
              "Ancestry attaches Thomas to the Harkinses of Wilmington, Delaware, who came from County Tyrone, "
              "but his death certificate shows they're a different family.",
     "people": ["@R-william-harkins-1859@", "@I342198302222@", "@I342198309762@", "@I342198309806@"]},
    {"key": "perret", "title": "Perret", "who": "@I342198310332@",
     "origins": ["Switzerland", "France", "Philadelphia"],
     "story": "Mary Frances Perret was born in Philadelphia in 1920, the oldest child of Joseph H. Perret and "
              "Mary Martin, who took out their marriage license there on 8 July 1919. Joseph (1895–1962) was "
              "the son of Henry Eugene Perret, a Swiss watch case maker who came to America in 1880, and Eugenia "
              "Buchy, born in Philadelphia to French parents; in 1900 the family was living in Riverside, New "
              "Jersey. Mary Martin's mother was "
              "Mary Ann McAvoy (1880–1950), daughter of Dennis McAvoy and Rose Bradley. Mary Frances's youngest "
              "brother, Gene Perret (1937–2022), became an Emmy-winning comedy writer for The Carol Burnett "
              "Show and Bob Hope.",
     "people": ["@I342198310488@", "@R-henry-eugene-perret@", "@I342198311003@", "@I342198310493@"]},
    {"key": "dymond", "title": "Dymond", "who": "@I342198307183@",
     "origins": ["Dutchess County, NY", "Connecticut", "Alsace", "Germany"],
     "story": "Glen A. Dymond Jr. was born in Scranton in 1926 and lost his mother, Marjorie Schuler, when he "
              "was two. Marjorie's father, Fred Schuler, was the son of German immigrants John Schuler and "
              "Margaret Sames and worked for the Delaware, Lackawanna & Western Railroad in Scranton. Glen Jr. "
              "lived in Queens, Scranton and Hartsville, South Carolina, served in the Navy in 1944 and settled "
              "in Blackwood, NJ. His father, Glen Austin Dymond Sr., was born in Lockville, later worked in "
              "stores in Raleigh and Asheville, and is buried near Asheville. Glen Sr.'s father Wayman left the "
              "family: the farm was sold at sheriff's sale in 1909 and where he ended up isn't known. The "
              "Dymonds go back through Lockville and Dymond Hollow in Exeter Township, PA, to Matthew Dymond "
              "Sr., born 1740 in Dutchess County, NY. Side branches reach colonial Connecticut (Whitlock, "
              "Strong, Hide) and Pennsylvania Germans from Alsace (Eyer, Werkheiser, Trautmann). This is the "
              "deepest part of the tree, back to about 1600.",
     "people": ["@I342198310990@", "@I342198310890@", "@I342201042904@", "@R-john-strong@"]},
    {"key": "henwood", "title": "Henwood", "who": "@I342198741673@",
     "origins": ["Germany", "France", "Derbyshire, England", "County Donegal"],
     "story": "Margaret Henwood is one of at least 11 children of Abraham Edward Henwood and Agnes Dougherty, "
              "who raised their family in Pennsauken, NJ. The Henwoods trace to Abraham Henwood, born in "
              "Germany in 1784, a carter in Southwark who served in the War of 1812 militia and died in "
              "Philadelphia in 1855. His son William married Mary Jolley at Trinity Episcopal in Southwark in "
              "1844; the Jolleys came from Derbyshire, England. Abraham Edward's mother, Emily Tatu, was the "
              "daughter of French immigrants Joseph Tatu and Louise Brodenbraugh. Agnes's parents, Miles "
              "Dougherty of County Donegal and Margaret Roarty, came from Ireland around 1874 and settled in "
              "Easton, PA, where Miles worked as a foundry moulder until he died on Christmas Day 1927.",
     "people": ["@I342202235553@", "@R-joseph-tatu@", "@I342198785512@", "@I342198785508@"]},
]

# Fixed on Ancestry on 6 Nov 2026 and dropped from this list: Miles Dougherty Sr. attached as his own
# son's child (plus the duplicates that made), and duplicate copies of Kevin Harkins, Margaret M Dymond,
# Margaret Henwood and her parents. Also dropped because the research settles them on the site:
# Margaretha Fenner, Sarah Booth and Rebecca Parkman as mothers, the Kutzenhausen places, the notes typed
# into names and Mary Morley's maiden name. Problems inside the Wilmington Harkins family (Daniel's
# marriage dates, the two Timothy Fitzpatricks) went with it once it turned out not to be Mike's.
ISSUES = [
    {"level": "error", "title": "Thomas M. Harkins is attached to the wrong parents",
     "body": "Ancestry makes him a son of William Andrew Harkins and Jane Veronica Fitzpatrick of Wilmington, "
             "Delaware. His 1943 death certificate names his parents as William Harkins and Anna, both born in "
             "Philadelphia, and the 1900 and 1910 censuses have him in that William's household. William "
             "Andrew's own memorial lists nine children and no Thomas. With the link gone, the Wilmington "
             "family (Daniel Harkins, Esther Dawson, the Fitzpatricks and Dawsons) no longer connects to yours.",
     "fix": "Detach Thomas from William Andrew and Jane, add William Harkins (1859–1938) and Anna as his "
            "parents, then delete the Wilmington family or keep it as a separate tree.",
     "people": ["@I342198302222@", "@I342198309846@", "@R-william-harkins-1859@"]},
    {"level": "error", "title": "A 103-year lifespan",
     "body": "Mary \"Polly\" Lawson is listed as born about 1771 and died 18 Nov 1874. Her death date probably "
             "belongs to someone else. Matthew Dymond Sr. (1740 to about 1839) is also unusually long-lived.",
     "fix": "Look for a grave or probate record for each.",
     "people": ["@I342200912339@", "@I342201042904@"]},
    {"level": "check", "title": "James Morley's birth year",
     "body": "The tree has him born about August 1845. The 1900 census gives August 1855 (age 44) and his "
             "1936 death certificate March 1851 (age 85). The census makes his wife Mary about four years "
             "younger than her death certificate does, too.",
     "fix": "Change his birth to Mar 1851 unless an Irish baptism says otherwise.",
     "people": ["@I342198309762@"]},
    {"level": "duplicate", "title": "H. Marjorie Dymond has no mother",
     "body": "She was born about 1928 in New Jersey and sits in a family with Glen Dymond Sr. and no wife. "
             "Jean, who was in that family too, is Marjorie Schuler's daughter according to Find a Grave and "
             "has been moved there on the site.",
     "fix": "Find H. Marjorie in the 1930 or 1940 census; if she's Marjorie Schuler's daughter, move her too.",
     "people": ["@I342198309689@", "@I342198741934@", "@I342198309705@"]},
    {"level": "check", "title": "Agnes Dougherty is missing from her father's obituary",
     "body": "Miles Dougherty's December 1927 obituary lists his surviving children without Agnes, yet the "
             "1930 census in the tree has her alive in Pennsauken.",
     "fix": "Check that the Agnes in the census is the same person, and look for her own death record.",
     "people": ["@I342198784186@", "@I342198785512@"]},
    {"level": "check", "title": "Six people aren't connected to the family",
     "body": "A couple and a family of four, listed below, aren't linked to anyone in your line.",
     "fix": "Link them to whoever they belong to, or delete them.",
     "people": ["@I342199508347@", "@I342199508348@", "@I342217478880@", "@I342217479011@",
                "@I342217479095@", "@I342217478836@"]},
]

LEADS = [
    {"title": "Trace William Harkins Sr. and Anna Regent",
     "body": "William Harkins (1859–1938)'s death certificate names his parents as William Harkins and Anna "
             "Regent, both born in Philadelphia. The 1860, 1870 and 1880 censuses should show the family and "
             "where William Sr.'s own parents came from. A first search found no Philadelphia William Harkins of "
             "the right age in 1860 or 1870, so the family is probably indexed under another spelling, as it "
             "was in 1910 (Huskins). Thomas's mother Anna also needs a maiden name and a "
             "death date; she was gone from the household by 1900. A Philadelphia Inquirer death notice for "
             "William in February 1938 may name the rest of his children.",
     "people": ["@R-william-harkins-1859@", "@R-william-harkins-sr@", "@R-anna-harkins@"]},
    {"title": "Find Mary Martin's father",
     "body": "Mary Martin Perret's mother was Mary Ann McAvoy, who died as Mary Ann Martin in 1950. The "
             "application for Mary's 8 July 1919 marriage license names both her parents and is on "
             "FamilySearch with a free account; the 1900 and 1910 Philadelphia censuses should show the Martin "
             "household.",
     "people": ["@I342198310489@", "@I342198311003@"]},
    {"title": "Find where Henry Eugene Perret came from",
     "body": "He was born in Switzerland in March 1858, came over in 1880 and had filed his first "
             "naturalization papers by 1900, when he made watch cases in Riverside, NJ. Those papers or a "
             "passenger list would name his home town. He hasn't turned up in the 1910 census, when his son "
             "Alphonse was probably in a Philadelphia children's home, so he may have died in between.",
     "people": ["@R-henry-eugene-perret@", "@R-eugenia-buchy@"]},
    {"title": "Find death records for Helen Morley Harkins and Mary Martin Perret",
     "body": "Neither great-grandmother has a firm death date yet. The Social Security Death Index has possible "
             "matches; an obituary would confirm one and give a burial place.",
     "people": ["@I342198302220@", "@I342198310489@"]},
    {"title": "Find Marjorie Schuler's grave and confirm her mother",
     "body": "She's in the 1910 Scranton census as Helen M., with her parents Fred and Helen and sisters May "
             "and Ruth. Her death certificate gives her burial as Calvary Cemetery, with the town unclear; the "
             "Dymond family genealogy says Olyphant. Her mother is probably Helen Carney (1878–1953), but no "
             "record yet ties that Helen to Fred.",
     "people": ["@I342198309705@", "@I342198310890@", "@I342198310928@"]},
    {"title": "Find Mary Booth's parents",
     "body": "Published Connecticut genealogies confirmed the Whitlock and Strong lines and added a generation "
             "to each, but showed that the Booth, Hollister and Treat ancestors belonged to a different family, "
             "so they're off the site. Mary was born about 1799 in Ulster County, New York, where her husband "
             "Joseph Dymond Sr. was also born. Most other facts before 1850 on the Dymond side still have no "
             "sources.",
     "people": ["@I342200912332@", "@I342200912324@"]},
]


def public_people(people):
    """The GitHub Pages copy: no unconnected people, and only names and relationships for the living."""
    keep = {pid for pid, p in people.items() if p["rel"] != NOT_CONNECTED}
    out = {}
    for pid in keep:
        p = {k: v for k, v in people[pid].items() if k != "issues"}
        p["father"] = p["father"] if p["father"] in keep else None
        p["mother"] = p["mother"] if p["mother"] in keep else None
        p["sibs"] = [s for s in p["sibs"] if s in keep]
        p["fams"] = [{"spouse": f["spouse"] if f["spouse"] in keep else None,
                      "kids": [k for k in f["kids"] if k in keep],
                      "marr": "" if p["living"] or people.get(f["spouse"], {}).get("living") else f["marr"]}
                     for f in p["fams"]]
        if p["living"]:
            p.update(by=None, dy=None, bp="", ev=[], nsrc=0)
        out[pid] = p
    return out


def write(path, payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = (Path(__file__).parent / "tree_template.html").read_text(encoding="utf-8")
    path.parent.mkdir(exist_ok=True)
    path.write_text(template.replace("/*__DATA__*/{}", data), encoding="utf-8")


def main():
    ged = Path(sys.argv[1]) if len(sys.argv) > 1 else max(
        (ROOT_DIR / "ancestry-export").glob("*.ged"), key=lambda p: p.stat().st_mtime)
    people, stats, root = build(ged)
    # keep curated references that still exist in this export
    for group in (LINES, ISSUES, LEADS):
        for item in group:
            item["people"] = [p for p in item.get("people", []) if p in people]
    flags = defaultdict(list)
    for i, iss in enumerate(ISSUES):
        for p in iss["people"]:
            flags[p].append(i)
    for pid, idx in flags.items():
        people[pid]["issues"] = idx
    out = ROOT_DIR / "family-tree.html"
    write(out, {"people": people, "root": root, "stats": stats,
                "lines": LINES, "issues": ISSUES, "leads": LEADS})
    print(f"{stats['people']} people, {stats['direct']} direct ancestors, "
          f"{stats['generations']} generations -> {out}")

    pub = public_people(people)
    trim = lambda group: [{**item, "people": [p for p in item["people"] if p in pub]} for item in group]
    site = ROOT_DIR / "docs" / "index.html"
    write(site, {"people": pub, "root": root, "stats": {**stats, "people": len(pub)},
                 "lines": trim(LINES), "issues": [], "leads": trim(LEADS), "public": True})
    print(f"public copy: {len(pub)} people, {sum(p['living'] for p in pub.values())} shown as living -> {site}")


if __name__ == "__main__":
    main()
