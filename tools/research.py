"""Web research of 6 Nov 2026, layered over the Ancestry export when the site is built.

The second half of the day used Mike's Ancestry subscription: Pennsylvania death certificates and the
1900 and 1910 censuses (marked "Ancestry records" below).

Ancestry itself isn't changed. The evidence for each item is in research/web-research-2026-11-06.md.
Person and family ids are Ancestry's; people and families added here have ids starting @R. After a
re-export, anything that no longer fits (a person gone, parents or a spouse already there, a child
with the same name) is skipped with a warning; facts are added regardless, so drop any that reach Ancestry.
"""

import re

DATE = "6 Nov 2026"
NEW_PEOPLE, NEW_FAMILIES, SPOUSES, CHILDREN, MOVES, UNLINKS, RENAMES, FIXES, ADDS, DROPS, MARRIAGES, DETACH = (
    [] for _ in range(12))


def cite(title, url=""):
    return {"t": title, "p": url, "u": url, "r": True} if url else {"t": title, "p": "", "r": True}


def fag(n, note=""):
    return cite(f"Find a Grave memorial {n}{note}", f"https://www.findagrave.com/memorial/{n}")


def new(pid, name, surname, sex, born="", died="", src=None, bplace="", dplace="", buried="", ddetail=""):
    NEW_PEOPLE.append({"id": pid, "name": name, "surname": surname, "sex": sex, "src": src, "facts": [
        f for f in [("BIRT", born, bplace, ""), ("DEAT", died, dplace, ddetail), ("BURI", "", buried, "")]
        if f[1] or f[2] or f[3]]})
    return pid


def family(fid, husb, wife, kids=(), marr=None):
    NEW_FAMILIES.append({"id": fid, "husb": husb, "wife": wife, "chil": list(kids), "marr": marr})


def spouse(fid, role, pid):
    SPOUSES.append((fid, role, pid))


def children(fid, *pids):
    CHILDREN.append((fid, list(pids)))


def fix(who, tag, src, match=None, **changes):
    """Change date, place or detail on a fact; what Ancestry had is kept in the fact's detail."""
    FIXES.append((who, tag, src, match, changes))


def add(who, tag, src, date="", place="", detail="", label=None):
    ADDS.append((who, {"tag": tag, "date": date, "place": place, "detail": detail, "label": label}, src))


def note(who, text, src=None):
    add(who, "NOTE", src, detail=text, label="Note")


# ---------------------------------------------------------------- sources used more than once

DYMOND_1981 = cite("R. H. Dymond, Genealogy of the Dymond, Williams and Related Families (1981), "
                   "on Find a Grave memorial 302406994", "https://www.findagrave.com/memorial/302406994")
MORNING_CALL = cite("Morning Call (Allentown), 28 Dec 1927, p. 7, transcribed on Find a Grave memorial 17719950",
                    "https://www.findagrave.com/memorial/17719950")
LEDGER_1919 = cite("Evening Public Ledger (Philadelphia), 8 Jul 1919, p. 2, “Today’s Marriage Licenses”",
                   "https://panewsarchive.psu.edu/lccn/sn83045211/1919-07-08/ed-1/seq-2/")
JOURNAL_1903 = cite("Evening Journal (Wilmington), 12 Jun 1903, p. 6, death notice",
                    "https://www.loc.gov/resource/sn85042354/1903-06-12/ed-1/?sp=6")
GENE = cite("Gene Perret, Wikipedia; Prabook: “Son of Joseph H. and Mary (Martin) Perret”",
            "https://en.wikipedia.org/wiki/Gene_Perret")
BRADSBY = cite("Bradsby, History of Luzerne County (1893), p. 862")
DWIGHT = cite("Dwight, The Descendants of Elder John Strong (1871), pp. 1072–74")
BAILEY = cite("Bailey, Early Connecticut Marriages, book 5")
JACOBUS = cite("Jacobus, Whitlock family, via WikiTree")
SCHENCK = cite("Schenck, History of Fairfield, vol. 1")
KUTZENHAUSEN = cite("Kutzenhausen parish register excerpts")
SCRANTON_1900 = cite("Scranton Tribune, 14 Dec 1900, p. 6")
EGGLESTON_FAG = fag(34515096)
WAYMAN_FAG = fag(302406994)


def pa_death(cert, year, record):
    return cite(f"Pennsylvania death certificate {cert} ({year})" if cert else f"Pennsylvania death certificate ({year})",
                f"https://www.ancestry.com/search/collections/5164/records/{record}")


def census(year, where, record, coll):
    return cite(f"{year} U.S. census, {where}", f"https://www.ancestry.com/search/collections/{coll}/records/{record}")

# ---------------------------------------------------------------- Harkins, Morley, Fitzpatrick

THOMAS = "@I342198302222@"
THOMAS_CERT = pa_death(59708, 1943, 4604249)
fix(THOMAS, "BIRT", THOMAS_CERT, date="26 Nov 1888", place="Philadelphia, Pennsylvania, USA")
add(THOMAS, "OCCU", THOMAS_CERT, detail="Engineer for a stevedoring business.")
add(THOMAS, "DEAT", THOMAS_CERT, "23 Jun 1943", "Philadelphia, Pennsylvania, USA",
    "At home, 1529 S. Etting St. His wife Helen V. Harkins gave the details.")
add(THOMAS, "BURI", fag(209547745), "28 Jun 1943", "Holy Cross Cemetery, Yeadon, Pennsylvania, USA",
    "A MORLEY/HARKINS family stone stands in Sec. 15, Range 2 (Find a Grave 17186085).")
DETACH.append(THOMAS)
note(THOMAS, "His death certificate names his parents as William Harkins and Anna, both born in Philadelphia, and "
             "the 1900 and 1910 censuses show him living with that William. Ancestry attaches him to William Andrew "
             "Harkins and Jane Fitzpatrick of the Wilmington family instead, whose children don't include a "
             "Thomas, so that link is left off this site.", THOMAS_CERT)

# William Harkins (1859–1938), Thomas's father, and his two wives
WILLIAM = "@R-william-harkins-1859@"
WILLIAM_CERT = pa_death(12613, 1938, 3395587)
C1900 = census(1900, "Philadelphia Ward 39, ED 1009, sheet 16", 42300688, 7602)
C1910 = census(1910, "Philadelphia Ward 1, ED 28, sheet 2B (indexed as Huskins)", 25223947, 7884)
new(WILLIAM, "William Harkins", "Harkins", "M", "5 Feb 1859", "19 Feb 1938", WILLIAM_CERT,
    "Philadelphia, Pennsylvania, USA", "Philadelphia, Pennsylvania, USA",
    "Holy Cross Cemetery, Yeadon, Pennsylvania, USA", "At home, 2637 S. Chadwick St.")
fix(WILLIAM, "BURI", WILLIAM_CERT, date="23 Feb 1938")
add(WILLIAM, "RESI", C1900, "1900", "2532 Stampers Lane, Philadelphia Ward 39, Pennsylvania, USA",
    "With his children Mary, Thomas, George and Phillip; no wife in the household.")
add(WILLIAM, "RESI", C1910, "1910", "112 McClellan St., Philadelphia Ward 1, Pennsylvania, USA",
    "With his wife Katie, his sons Thomas and Philip, and their children Katharine and William.")
ANNA = new("@R-anna-harkins@", "Anna Garrity", "Garrity", "F", src=THOMAS_CERT, bplace="Philadelphia, Pennsylvania, USA")
note(ANNA, "Thomas's death certificate gives her maiden name as Garrity, but William's second wife was Katherine A. "
           "Garrity, so the informant may have mixed the two up. Anna wasn't in the 1900 household and had "
           "probably died by then.", THOMAS_CERT)
family("@R-harkins-anna@", WILLIAM, ANNA, [
    new("@R-mary-harkins-1884@", "Mary Harkins", "Harkins", "F", "abt 1884", src=C1900, bplace="Pennsylvania, USA"),
    THOMAS,
    new("@R-george-harkins-1893@", "George Harkins", "Harkins", "M", "abt 1893", src=C1900, bplace="Pennsylvania, USA"),
    new("@R-phillip-harkins-1897@", "Phillip Harkins", "Harkins", "M", "abt 1897", src=C1900, bplace="Pennsylvania, USA")])
family("@R-harkins-katherine@", WILLIAM,
       new("@R-katherine-garrity@", "Katherine A. Garrity", "Garrity", "F", "abt 1869", src=C1910),
       marr=("1904", "Philadelphia, Pennsylvania, USA", cite("Philadelphia Marriage Index, 1885–1951")))
note("@R-katherine-garrity@", "Katherine A. in the marriage index; Catherine E. on William's death certificate, "
                              "for which she was the informant (Mrs. K. Harkins).", WILLIAM_CERT)
family("@R-harkins-regent@",
       new("@R-william-harkins-sr@", "William Harkins", "Harkins", "M", src=WILLIAM_CERT, bplace="Philadelphia, Pennsylvania, USA"),
       new("@R-anna-regent@", "Anna Regent", "Regent", "F", src=WILLIAM_CERT, bplace="Philadelphia, Pennsylvania, USA"),
       [WILLIAM])

# the Morleys
JAMES_M = "@I342198309762@"
JAMES_CERT = pa_death(36672, 1936, 5309638)
fix(JAMES_M, "BIRT", JAMES_CERT, date="Mar 1851", detail="Age 85 at his death.")
fix(JAMES_M, "DEAT", JAMES_CERT)
add(JAMES_M, "BURI", fag(143235707), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA")
family("@R-morley-james@",
       new("@R-patrick-morley-james@", "Patrick Morley", "Morley", "M", src=JAMES_CERT, bplace="Ireland"),
       new("@R-bridget-bymer@", "Bridget Bymer", "Bymer", "F", src=JAMES_CERT, bplace="Ireland"), [JAMES_M])
note("@R-bridget-bymer@", "Her surname is as indexed from James's death certificate.", JAMES_CERT)

MARY_M = "@I342198309806@"
MARY_CERT = pa_death(95980, 1928, 4749998)
fix(MARY_M, "BIRT", MARY_CERT)
fix(MARY_M, "DEAT", MARY_CERT)
add(MARY_M, "BURI", fag(143235815), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA")
note(MARY_M, "Her death certificate names her parents as Patrick Morley and Mary Conway, so Morley was her maiden "
             "name as well as her married one. Her husband James's father was also a Patrick Morley.", MARY_CERT)
for pid in ("@I342199506306@", "@I342199506324@"):
    note(pid, "Named as Mary Morley's parent on her 1928 death certificate.", MARY_CERT)
RENAMES += [("@I342198309806@", "Mary Morley", "Morley"), ("@I342199506306@", "Patrick Morley", "Morley"),
            ("@I342199506324@", "Mary Conway", "Conway")]
# Patrick J. Morley, Helen's brother
children("@F41@", new("@R-patrick-j-morley@", "Patrick J. Morley", "Morley", "M", "8 Aug 1873", "17 Mar 1911",
                      fag(142641911), ddetail="Drowned in the Delaware River."))

JANE_V = "@I342198309850@"
RENAMES.append((JANE_V, "Jane Veronica Fitzpatrick", "Fitzpatrick"))
fix(JANE_V, "BIRT", fag(113142246), date="2 Jul 1862")
add(JANE_V, "BURI", fag(113142246), place="St. Dominic Cemetery, Holmesburg, Philadelphia, Pennsylvania, USA",
    detail="Sec. L, Range 11, Lot 68, under a family stone.")
fix("@I342198309846@", "BURI", fag(113142270), place="St. Dominic Cemetery, Holmesburg, Philadelphia, Pennsylvania, USA",
    detail="Same lot as his wife Jane.")
MARRIAGES.append(("@F3@", "1887", "", fag(113142270)))
add("@I342198431751@", "BURI", fag(113143716), place="St. Joachim Cemetery, Philadelphia, Pennsylvania, USA",
    detail="Buried with his wife Jane.")

# Jane Trainor and the rest of John Fitzpatrick's children (her memorial lists all seven)
spouse("@F47@", "wife", new("@R-jane-trainor@", "Jane Trainor", "Trainor", "F", "May 1829", "27 Dec 1905",
                            fag(25658504), "Ireland", "Philadelphia, Pennsylvania, USA",
                            "St. Joachim Cemetery, Philadelphia, Pennsylvania, USA"))
children("@F47@", *[new(f"@R-fitzpatrick-{i}@", name, "Fitzpatrick", sex, b, d, fag(25658504)) for i, (name, sex, b, d) in
                    enumerate([("John James Fitzpatrick", "M", "1853", "1925"), ("Thomas J. Fitzpatrick", "M", "1855", "1886"),
                               ("Mary E. Fitzpatrick Slaven", "F", "1856", "1943"), ("Charles Fitzpatrick", "M", "1860", "1935"),
                               ("Francis Fitzpatrick", "M", "1863", "1868"), ("James J. Fitzpatrick", "M", "1867", "1913")])])

DANIEL = "@I342198361470@"
fix(DANIEL, "DEAT", JOURNAL_1903, match="18 Jun 1903",
    detail="Date carved on the family stone, which was cut after 1910. His death notice gives 11 June.")
add(DANIEL, "EVEN", JOURNAL_1903, "15 Jun 1903", "Wilmington, New Castle, Delaware, USA",
    "From his son-in-law W. J. Connolly's home, 907 Spruce St.; Mass at St. Mary's.", label="Funeral")

# ---------------------------------------------------------------- Perret, Martin

for pid in ("@I342198310488@", "@I342198310489@"):
    add(pid, "EVEN", LEDGER_1919, "8 Jul 1919", "Philadelphia, Pennsylvania, USA",
        "Joseph H. Perret and Mary Martin; he lived in the 48th Ward.", label="Marriage license")

GENE_ID = "@I342198310493@"
RENAMES.append((GENE_ID, "Eugene Richard “Gene” Perret", "Perret"))
fix(GENE_ID, "BIRT", GENE, date="3 Apr 1937", place="Philadelphia, Pennsylvania, USA")
add(GENE_ID, "OCCU", GENE, detail="Emmy-winning television comedy writer for The Carol Burnett Show and Bob Hope.")
add(GENE_ID, "DEAT", GENE, "15 Nov 2022", "Westlake Village, California, USA")
add(GENE_ID, "BURI", GENE, place="Valley Oaks Memorial Park, Westlake Village, California, USA")

JOSEPH_P = "@I342198310488@"
JOSEPH_CERT = pa_death("089060-62", 1962, 5661010)
P1900 = census(1900, "Riverside, Burlington County, New Jersey, sheet 21", 44924300, 7602)
H1900 = census(1900, "Riverside, Burlington County, New Jersey, sheet 21", 44924297, 7602)  # Henry's own entry
E1900 = census(1900, "Riverside, Burlington County, New Jersey, sheet 21", 44924298, 7602)  # Eugenia's
fix(JOSEPH_P, "BIRT", JOSEPH_CERT, date="23 Mar 1895", place="Philadelphia, Pennsylvania, USA")
add(JOSEPH_P, "RESI", P1900, "1900", "7 Jefferson St., Riverside, Burlington, New Jersey, USA",
    "With his parents, his sister Philomena and his brothers Eugene and Alphonse. The census gives his birth as "
    "March 1894.")
add(JOSEPH_P, "DEAT", JOSEPH_CERT, "25 Sep 1962", "Philadelphia, Pennsylvania, USA")
EUGENIA = new("@R-eugenia-buchy@", "Eugenia Buchy", "Buchy", "F", "Dec 1863", "13 Sep 1938", pa_death(77436, 1938, 3961205),
              "Philadelphia, Pennsylvania, USA", "Philadelphia, Pennsylvania, USA")
note(EUGENIA, "Her own 1900 census entry says she was born in Pennsylvania to French-born parents; her son Joseph's "
              "entry gives France. Her death certificate says Philadelphia and spells her name Buckey.", E1900)
HENRY = new("@R-henry-eugene-perret@", "Henry Eugene Perret", "Perret", "M", "Mar 1858", src=H1900,
            bplace="Switzerland")
note(HENRY, "Henry E. in the 1900 census and Eugene on his children's death certificates.", JOSEPH_CERT)
family("@R-perret@", HENRY, EUGENIA, [
    new("@R-philomena-perret@", "Philomena Perret", "Perret", "F", "abt 1892", src=H1900),
    JOSEPH_P,
    new("@R-eugene-perret-1897@", "Eugene Perret", "Perret", "M", "10 Feb 1897", "3 Aug 1947",
        pa_death("", 1947, 7463439), dplace="Canaan, Wayne, Pennsylvania, USA"),
    new("@R-alphonse-perret@", "Alphonse Perret", "Perret", "M", "18 Nov 1898", "4 Apr 1946", pa_death(38096, 1946, 5552991),
        "Riverside, New Jersey, USA", "Philadelphia, Pennsylvania, USA")])
family("@R-buchy@", new("@R-michael-buckey@", "Michael Buckey", "Buckey", "M", src=pa_death(77436, 1938, 3961205)),
       new("@R-helen-benty@", "Helen Benty", "Benty", "F", src=pa_death(77436, 1938, 3961205)), [EUGENIA])

MCAVOY = "@I342198311003@"
MCAVOY_CERT = pa_death(27075, 1950, 6365373)
fix(MCAVOY, "BIRT", MCAVOY_CERT)
fix(MCAVOY, "DEAT", MCAVOY_CERT)
family("@R-mcavoy@", new("@R-dennis-mcavoy@", "Dennis McAvoy", "McAvoy", "M", src=MCAVOY_CERT),
       new("@R-rose-bradley@", "Rose Bradley", "Bradley", "F", src=MCAVOY_CERT),
       [new("@R-margaret-mcavoy@", "Margaret McAvoy Hance", "McAvoy", "F", "abt 1874", "18 Sep 1913",
            pa_death(96460, 1913, 1962801), "Philadelphia, Pennsylvania, USA", "Philadelphia, Pennsylvania, USA"),
        MCAVOY])

FRED = "@I342198310890@"
FRED_CERT = pa_death(91185, 1942, 4613737)
S1910 = census(1910, "Scranton Ward 11, ED 93, sheet 8A (indexed as Ford Schales)", 24757646, 7884)
fix(FRED, "BIRT", FRED_CERT, date="27 Jul 1880", place="Scranton, Lackawanna, Pennsylvania, USA")
add(FRED, "RESI", S1910, "1910", "Scranton Ward 11, Lackawanna, Pennsylvania, USA",
    "Laborer for the Delaware, Lackawanna & Western Railroad; married about 1902; both his parents born in Germany.")
add(FRED, "DEAT", FRED_CERT, "30 Oct 1942", "Ransom, Lackawanna, Pennsylvania, USA")
family("@R-schuler@", new("@R-john-schuler@", "John Schuler", "Schuler", "M", src=FRED_CERT, bplace="Germany"),
       new("@R-margaret-sames@", "Margaret Sames", "Sames", "F", src=FRED_CERT, bplace="Germany"), [FRED])
note("@I342198310928@", "Probably Helen Carney (17 Mar 1878, Ireland – 25 Dec 1953, Scranton), daughter of John Carney "
                        "and Ellen McAweeney, a Schuler widow in Scranton. Not yet tied to Fred by a record.",
     pa_death(106902, 1953, 5923500))
add("@I342198309705@", "RESI", S1910, "1910", "Scranton Ward 11, Lackawanna, Pennsylvania, USA",
    "Listed as Helen M., age 6, with her parents and sisters May and Ruth.")
children("@F32@", new("@R-may-schuler@", "May Schuler", "Schuler", "F", "abt 1906", src=S1910),
         new("@R-ruth-schuler@", "Ruth Schuler", "Schuler", "F", "abt 1909", src=S1910))

# ---------------------------------------------------------------- Henwood, Dougherty, Tatu

MILES = "@I342198785512@"
fix(MILES, "BIRT", MORNING_CALL, place="County Donegal, Ireland",
    detail="His obituary gives his age as 78, which would put his birth about 1849.")
fix(MILES, "DEAT", MORNING_CALL, date="25 Dec 1927",
    detail="At his daughter Mrs. William Shannon's, 487 Berwick St., after a fall following a stroke.")
add(MILES, "BURI", MORNING_CALL, place="St. Bernard's Cemetery, Easton, Pennsylvania, USA")
add(MILES, "OCCU", MORNING_CALL, detail="Moulder at the Warren Foundry, Phillipsburg, New Jersey.")
fix("@I342198785508@", "BIRT", fag(17719956), detail="Find a Grave gives 9 Jun 1859.")
add("@I342198785508@", "BURI", fag(17719956), place="St. Bernard's Cemetery, Easton, Pennsylvania, USA")
RENAMES.append(("@I342198784186@", "Agnes C Dougherty", "Dougherty"))

ABRAHAM_E = "@I342198784189@"
RENAMES.append((ABRAHAM_E, "Abraham Edward Henwood", "Henwood"))
note(ABRAHAM_E, "Middle name Edward, from the 2012 obituary of his daughter Sr. Agnes Edward Henwood, O.P.",
     cite("Catholic Star Herald, 2012", "https://catholicstarherald.org/dominican-sister-agnes-edward-henwood-101-dies/"))
children("@F23@", *[new(f"@R-henwood-{i}@", name, "Henwood", sex, b, d, fag(23739043)) for i, (name, sex, b, d) in
                    enumerate([("Louise Henwood Wenner", "F", "1886", "1966"), ("Mary J. Henwood Wolfinger", "F", "1887", "1956"),
                               ("William J. Henwood", "M", "1889", "1958"), ("Emily T. Henwood O'Connor", "F", "1891", "1976"),
                               ("Emile Henwood", "M", "1893", "1981"), ("Harry Francis Henwood", "M", "1896", "1980")])])

EMILY = "@I342219651209@"
EMILY_CERT = pa_death(60290, 1912, 365220)
fix(EMILY, "BIRT", EMILY_CERT, detail="Her death certificate agrees; Find a Grave has 1858.")
fix(EMILY, "DEAT", EMILY_CERT)
add(EMILY, "BURI", fag(23739043), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA", detail="Sec. 32, Range 10.")
family("@R-tatu@",
       new("@R-joseph-tatu@", "Joseph Tatu", "Tatu", "M", "1826", "2 Feb 1873", fag(230881556), "France",
           "Philadelphia, Pennsylvania, USA", "Holy Cross Cemetery, Yeadon, Pennsylvania, USA"),
       new("@R-louise-tatu@", "Louise Brodenbraugh", "Brodenbraugh", "F", "1834", "17 Oct 1906", fag(206909107), "France",
           buried="Holy Cross Cemetery, Yeadon, Pennsylvania, USA"),
       [new("@R-emile-tatu@", "Emile Tatu", "Tatu", "M", "1857", "1925", fag(230881556, ", family links")), EMILY,
        new("@R-elizabeth-tatu@", "Elizabeth Tatu", "Tatu", "F", "1866", "1944", fag(230881556, ", family links"))])

note("@R-louise-tatu@", "Maiden name Brodenbraugh on her daughter Emily's death certificate, which spells the "
                        "family name Tate; Find a Grave also gives Rothburg.", EMILY_CERT)

OLD_ABRAHAM = "@I342202235553@"
add(OLD_ABRAHAM, "OCCU", cite("Philadelphia city directories, 1817–1848 (archive.org)"),
    "1817–1848", "Southwark, Philadelphia, Pennsylvania, USA",
    "Carter and wood corder, on Catharine St., then at 66 Plum St.")
add(OLD_ABRAHAM, "MILI", cite("Pennsylvania Archives, 6th series, vol. 7, p. 91"), "1813",
    detail="War of 1812 militia, 24th Regiment.")
add("@I342219651253@", "BURI", fag(109815713), place="Old St. Paul's Episcopal Church, Philadelphia, Pennsylvania, USA")

# ---------------------------------------------------------------- Dymond, Eggleston, Schuler

GLEN_SR = "@I342198309689@"
RENAMES.append((GLEN_SR, "Glen Austin Dymond Sr.", "Dymond"))
fix(GLEN_SR, "BIRT", fag(122060799), place="Lockville, Wyoming County, Pennsylvania, USA")
add(GLEN_SR, "RESI", cite("Raleigh city directory, 1949 (archive.org)"), "1949", "Raleigh, North Carolina, USA",
    "Worked at the Mother & Daughter store.")
add(GLEN_SR, "RESI", cite("Asheville city directory, 1956 (archive.org)"), "1956", "Asheville, North Carolina, USA",
    "45 Henrietta St.; worked at Belk's.")
add(GLEN_SR, "BURI", fag(122060799), place="Pisgah View Memorial Park, Candler, North Carolina, USA")
MARRIAGES.append(("@F18@", "1923", "", fag(122060799)))
family("@R-glen-effie@", GLEN_SR, new("@R-effie-truesdale@", "Effie Olean Truesdale", "Truesdale", "F", "1910", "2002",
                                     fag(122060799, ", spouse link")))

MARJORIE = "@I342198309705@"
fix(MARJORIE, "BIRT", fag(287213490),
    detail="The Dymond family genealogy (1981) names her Helen Marjorie, born 17 May 1903.")
fix(MARJORIE, "BURI", cite("New York City death certificate 13656 (1929); Find a Grave memorial 287213490",
                           "https://www.findagrave.com/memorial/287213490"),
    place="Calvary Cemetery, Pennsylvania, USA",
    detail="The certificate reads “Calvary Cemetery, [one word unclear], Pa.”; the Dymond genealogy (1981) says "
           "Olyphant. A second Find a Grave memorial placing her in Calvary, Queens, misreads the certificate.")
JEAN = "@I342198741933@"
MOVES.append((JEAN, "@F18@"))
fix(JEAN, "BIRT", fag(188328785), date="1924")
add(JEAN, "DEAT", fag(188328785), "2021", detail="As Jean Dymond Burgess.")

WAYMAN = "@I342198310990@"
DROPS.append((WAYMAN, "DEAT", "ABT 1940"))
MARRIAGES.append(("@F16@", "28 Sep 1887", "Vernon, Wyoming County, Pennsylvania, USA", DYMOND_1981))
add(WAYMAN, "OCCU", cite("Scranton Tribune, 1897"), "1897", detail="Butcher.")
add(WAYMAN, "RESI", cite("Scranton Tribune, 1899"), "1899", "Moosic, Lackawanna, Pennsylvania, USA")
add(WAYMAN, "EVEN", DYMOND_1981, "24 Apr 1909", detail="The family farm was sold at sheriff's sale.", label="Farm sold")
add(WAYMAN, "RESI", DYMOND_1981, "abt 1915", "Punxsutawney, Pennsylvania, USA",
    "Ran a store there after leaving the family. The family genealogy says his final whereabouts are not known; "
    "the “about 1940” death on Ancestry has no source.")
children("@F16@", *[new(f"@R-glen-bro-{i}@", name, "Dymond", "M", b, d, WAYMAN_FAG) for i, (name, b, d) in
                    enumerate([("Leo Earle Dymond", "1888", "1976"), ("Howard W. Dymond", "1890", "1893"),
                               ("Ernest Dymond", "1892", "1895"), ("Russell Sage Dymond", "1894", "1972"),
                               ("Harold Dymond", "1896", "1897")])])
children("@F45@", *[new(f"@R-wayman-sib-{i}@", name, "Dymond", sex, b, d, WAYMAN_FAG) for i, (name, sex, b, d) in
                    enumerate([("Sarah C. Dymond Austin", "F", "1846", "1927"), ("Martin Luther Dymond", "M", "1847", "1932"),
                               ("Martha Dymond Saxe", "F", "1849", "1919"),
                               ("Frances “Fannie” Dymond Datesman Walker", "F", "1851", "1938"),
                               ("Abel Thompson Dymond", "M", "1852", "1940"), ("Samuel Dymond", "M", "1857", "1858"),
                               ("John Booth Dymond Jr.", "M", "1858", "1944"), ("Carrie Dymond Walker", "F", "1864", "1950"),
                               ("Berton Dymond", "M", "1867", "1868")])])

add("@I342198310961@", "BURI", EGGLESTON_FAG, place="Sunnyside Cemetery, Tunkhannock, Pennsylvania, USA")
MILES_E = "@I342200255170@"
OBIT_1900 = cite("Miles Eggleston obituary, 1900 (Betty Fitch Collection, archive.org)")
fix(MILES_E, "BIRT", OBIT_1900, detail="His obituary gives 7 Oct 1836, Northmoreland Township.")
add(MILES_E, "BURI", OBIT_1900, place="Sunnyside Cemetery, Tunkhannock, Pennsylvania, USA")
children("@F24@", *[new(f"@R-eggleston-{i}@", name, "Eggleston", sex, b, d, EGGLESTON_FAG) for i, (name, sex, b, d) in
                    enumerate([("Edith Eggleston VanTuyle", "F", "1868", "1939"), ("Rose Bell Eggleston", "F", "", "1871"),
                               ("Diantha Eggleston Sterner", "F", "1877", "1945"),
                               ("R. Clarence Eggleston", "M", "1880", "1951")])])

JOHN_BOOTH = "@I342200255235@"
fix(JOHN_BOOTH, "BIRT", cite("1870 U.S. census (FamilySearch index)"), detail="The 1870 census gives New York.")
add(JOHN_BOOTH, "BURI", fag(75253798), place="Dymond family cemetery, Dymond Hollow, Pennsylvania, USA")
add(JOHN_BOOTH, "PROB", cite("Scranton Tribune, 29 Apr 1899"), "Apr 1899", detail="Estate notice published.")
fix("@I342200255256@", "DEAT", SCRANTON_1900, place="Scranton, Lackawanna, Pennsylvania, USA",
    detail="At her daughter Mrs. George Saxe's home.")
add("@I342200255256@", "BURI", SCRANTON_1900, place="Dymond family cemetery, Dymond Hollow, Pennsylvania, USA")

JOSEPH_SR = "@I342200912324@"
RENAMES.append((JOSEPH_SR, "Joseph Dymond Sr.", "Dymond"))
add(JOSEPH_SR, "CENS", cite("1850 U.S. census (FamilySearch index)"), "1850", "Exeter, Luzerne, Pennsylvania, USA",
    "With children Luther, Mary, Joseph, George, Calvin, Charles and Louisa J.")
fix(JOSEPH_SR, "DEAT", BRADSBY, detail="Bradsby gives 1857.")

MARY_BOOTH = "@I342200912332@"
fix(MARY_BOOTH, "BIRT", BRADSBY, date="1799", place="Ulster County, New York, USA")
UNLINKS.append((MARY_BOOTH, "@I342207693072@"))
note(MARY_BOOTH, "Ancestry lists Sarah Booth (1770–1840) of Farmington, Connecticut, as her mother. Sarah lived and "
                 "died in Connecticut, so she and the Booth, Hollister and Treat ancestors above her are left off "
                 "this site.", cite("Jacobus, The Booth Family (1952)"))

# ---------------------------------------------------------------- colonial Connecticut, Alsace

POLLY = "@I342217257419@"
RENAMES.append((POLLY, "Polly Strong", "Strong"))
fix(POLLY, "BIRT", DWIGHT, date="23 Jan 1786", detail="Twin of Dolly.")
family("@R-strong@", new("@R-john-strong@", "Rev. John Strong", "Strong", "M", "1755", "1836", DWIGHT),
       new("@R-lydia-thomas@", "Lydia Thomas", "Thomas", "F", "1758", "1840", DWIGHT), [POLLY])

spouse("@F50@", "wife", new("@R-susannah-downs@", "Susannah Downs", "Downs", "F", src=BAILEY))
MARRIAGES.append(("@F50@", "10 Sep 1778", "Weston, Fairfield, Connecticut, USA", BAILEY))
RENAMES += [("@I342219650769@", "Joseph Whitlock", "Whitlock"), ("@I342219650814@", "Joseph Whitlock", "Whitlock")]

MARY_JARVIS = "@I342219650888@"
add(MARY_JARVIS, "EVEN", BAILEY, "17 Oct 1760", "Weston, Fairfield, Connecticut, USA", "To John Thorp of Norwalk.",
    label="Remarried")
UNLINKS.append((MARY_JARVIS, "@I342219650910@"))
note(MARY_JARVIS, "Ancestry lists Rebecca Parkman, who was born and died in England, as her mother; that link is "
                  "left off this site.")

THOMAS_W = "@I342219650827@"
fix(THOMAS_W, "BIRT", JACOBUS, date="abt 1690", detail="The 6 Mar 1693 date on Ancestry has no source.")
MARRIAGES.append(("@F7@", "24 Jan 1715/16", "Fairfield, Connecticut, USA", cite("Barbour Collection, Fairfield")))
family("@R-whitlock@", new("@R-john-whitlock@", "John Whitlock", "Whitlock", "M", died="1698",
                           dplace="Fairfield, Connecticut, USA",
                           src=cite("Jacobus, via WikiTree; Lineage Book (1923)")),
       new("@R-sarah-sherwood@", "Sarah Sherwood", "Sherwood", "F", src=cite("Jacobus, via WikiTree; Lineage Book (1923)")),
       [THOMAS_W])
family("@R-hide@", new("@R-john-hide@", "John Hide", "Hide", "M", "1668", "1744", SCHENCK),
       new("@R-rachel-rumsey@", "Rachel Rumsey", "Rumsey", "F", "1671", "1738", SCHENCK), ["@I342219650855@"])

spouse("@F54@", "wife", new("@R-anne-mosher@", "Anne Mosher", "Mosher", "F", "1745", "abt 1832",
                            cite("Wilsey; Pedigrees of Colonial Clergy; Doherty, via WikiTree"),
                            "Dartmouth, Massachusetts, USA", "Woodstock, Ulster, New York, USA"))

AMOS = "@I342219650927@"
fix(AMOS, "BIRT", cite("Vernon Cemetery transcription"), date="abt 1793",
    detail="His gravestone gives his age as 68 in 1861.")
UNLINKS.append((AMOS, "@I342219650965@"))
note(AMOS, "Ancestry lists Mary Brown (1777–1854) as his mother. She'd have been about 15 and died in Ontario, "
           "so that link is left off this site.")

WERKHEISER = "@I342219650996@"
UNLINKS.append((WERKHEISER, "@I342219651010@"))
note(WERKHEISER, "Ancestry lists Margaretha Fenner as his mother, but she died in 1810, two years before he was "
                 "born. She was his father's first wife, so she's left off this site.")

JACOB_EYER = "@I342219651087@"
for tag in ("BIRT", "DEAT"):
    fix(JACOB_EYER, tag, KUTZENHAUSEN, place="Feldbach, Kutzenhausen, Bas-Rhin, Alsace, France")
family("@R-eyer@", new("@R-peter-eyer@", "Peter Eyer", "Eyer", "M"), None, [JACOB_EYER])
add("@R-peter-eyer@", "RESI", KUTZENHAUSEN, place="Feldbach, Kutzenhausen, Bas-Rhin, Alsace, France")
add("@I342219651066@", "ARRI", cite("Strassburger and Hinke, Pennsylvania German Pioneers, vol. 1, list 139C"),
    "28 Sep 1749", "Philadelphia, Pennsylvania, USA", "On the ship Ann.")

# names with notes typed into them (the Booth branch is kept tidy for the local page)
RENAMES += [("@I342215060870@", "Elisha Booth", "Booth"), ("@I342215060931@", "Ann Hollister", "Hollister"),
            ("@I342200912396@", "John Lawson", "Lawson"), ("@I342200912404@", "Mary Liston", "Liston")]

# ---------------------------------------------------------------- deep search, first pass
# Records read before Ancestry started refusing requests, each checked against the record's own text.

FUNERAL_1938 = cite("Joseph J. Roberts, Funeral Director, burial record of William J. Harkins (1938)",
                    "https://www.ancestry.com/search/collections/2451/records/2021373189")
fix(WILLIAM, "BURI", FUNERAL_1938, detail="Joseph J. Roberts was the funeral director.")
note(WILLIAM, "The funeral director's record calls him William J. Harkins and, like his death certificate, names his "
              "parents as William Harkins and Anna Regent.", FUNERAL_1938)
note("@R-anna-regent@", "Regent on both her son William's death certificate and his funeral director's record. The "
                        "same person probably gave both, so the spelling isn't proven.", FUNERAL_1938)
fix(ANNA, "BIRT", C1900)  # her son Thomas's 1900 entry gives his mother's birthplace as Pennsylvania

PATRICK_J = "@R-patrick-j-morley@"
PATRICK_J_CERT = pa_death(31684, 1911, 2336322)
fix(PATRICK_J, "BIRT", PATRICK_J_CERT, place="Pennsylvania, USA")
fix(PATRICK_J, "DEAT", PATRICK_J_CERT, place="Philadelphia, Pennsylvania, USA")
note(PATRICK_J, "His death certificate names his parents as James and Mary Morley.", PATRICK_J_CERT)

M1900 = census(1900, "Philadelphia Ward 2, sheet 1", 52647056, 7602)
MANTON = "421 Manton St., Philadelphia Ward 2, Pennsylvania, USA"
add(JAMES_M, "RESI", M1900, "1900", MANTON, "With his wife Mary and their children Michael, James and Helen.")
add(JAMES_M, "IMMI", M1900, "1871", detail="The 1900 census says he came to the United States in 1871 and had been "
                                          "naturalized.")
add(JAMES_M, "OCCU", M1900, "1900", detail="Laborer.")
note(JAMES_M, "The 1900 census gives his birth as Aug 1855 and Mary's as about 1858, both about four years later than "
              "their death certificates do; the certificates' dates are used here.", M1900)
add(MARY_M, "RESI", M1900, "1900", MANTON, "With her husband James and their children Michael, James and Helen.")
add("@I342198302220@", "RESI", M1900, "1900", MANTON, "With her parents and her brothers Michael and James.")
MARRIAGES.append(("@F41@", "abt 1873", "", M1900))
children("@F41@", new("@R-michael-morley-1878@", "Michael Morley", "Morley", "M", "abt 1878", src=M1900),
         new("@R-james-morley-1881@", "James Morley", "Morley", "M", "abt 1881", src=M1900))

add(HENRY, "RESI", H1900, "1900", "7 Jefferson St., Riverside, Burlington, New Jersey, USA",
    "With his wife Eugenia, their children Philomena, Joseph, Eugene and Alphonse, and four boarders.")
add(HENRY, "IMMI", H1900, "1880", detail="The 1900 census says he came to the United States in 1880 and had filed "
                                        "his first naturalization papers.")
add(HENRY, "OCCU", H1900, "1900", "Riverside, Burlington, New Jersey, USA", "Watch case maker.")
MARRIAGES.append(("@R-perret@", "abt 1889", "", H1900))
add(EUGENIA, "RESI", E1900, "1900", "7 Jefferson St., Riverside, Burlington, New Jersey, USA",
    "With her husband Henry and their children Philomena, Joseph, Eugene and Alphonse.")
fix(EUGENIA, "BIRT", E1900)
note(EUGENIA, "By 1900 she had had five children, four of them living.", E1900)
for pid in ("@R-michael-buckey@", "@R-helen-benty@"):
    add(pid, "BIRT", E1900, place="France", detail="From their daughter Eugenia's 1900 census entry.")
note("@R-alphonse-perret@", "Probably the Alphonse Perret, born about 1899 in New Jersey, listed as an orphan in "
                            "Philadelphia's 41st Ward in the 1910 census, likely in a children's home. Only the "
                            "census index has been seen, not the page.",
     census(1910, "Philadelphia Ward 41 (index entry)", 25710743, 7884))

# ---------------------------------------------------------------- apply


def apply(people, families, labels):
    warnings = []

    def ev(tag, date="", place="", detail="", src=None, label=None):
        return {"tag": tag, "label": label or labels.get(tag, tag.title()), "date": date or "",
                "place": place or "", "detail": detail or "", "src": [src] if src else [], "res": True}

    def first_word(name):
        return name.replace("“", " ").split()[0].lower()

    def have(pid, what):
        if pid in people:
            return True
        warnings.append(f"{what}: {pid} isn't in this export")
        return False

    for p in NEW_PEOPLE:
        people[p["id"]] = {"id": p["id"], "name": p["name"], "surname": p["surname"], "sex": p["sex"],
                           "famc": [], "fams": [], "nsrc": 0,
                           "events": [ev(tag, d, pl, dt, p["src"]) for tag, d, pl, dt in p["facts"]]}

    for pid, name, surname in RENAMES:
        if have(pid, "rename"):
            people[pid].update(name=name, surname=surname)

    for who, tag, src, match, changes in FIXES:
        if not have(who, "fix"):
            continue
        e = next((e for e in people[who]["events"] if e["tag"] == tag and (match is None or e["date"] == match)), None)
        if not e:
            warnings.append(f"fix: {people[who]['name']} has no {tag} {match or ''}")
            continue
        # note what Ancestry had, unless the research only makes it more precise ("Ireland" -> "County Donegal, Ireland")
        old = [e[k] for k in ("date", "place") if k in changes and e[k] and e[k].lower() not in changes[k].lower()]
        for k in ("date", "place"):
            if k in changes:
                e[k] = changes[k]
        notes = " ".join(x for x in [changes.get("detail"), old and f"The Ancestry tree has {', '.join(old)}."] if x)
        e["detail"] = "; ".join(x for x in [e["detail"], notes] if x)
        e["src"] = e["src"] + [src] if src not in e["src"] else e["src"]
        e["res"] = True

    for who, fact, src in ADDS:
        if have(who, "add"):
            people[who]["events"].append(ev(fact["tag"], fact["date"], fact["place"], fact["detail"], src, fact["label"]))

    for who, tag, date in DROPS:
        if have(who, "drop"):
            people[who]["events"] = [e for e in people[who]["events"] if not (e["tag"] == tag and e["date"] == date)]

    def sort_children(fid):
        def born(c):  # birth year, or death year for a child with no birth
            for tag in ("BIRT", "DEAT"):
                for e in people[c]["events"]:
                    m = re.search(r"\b(?:1[5-9]\d\d|20\d\d)\b", e["date"]) if e["tag"] == tag else None
                    if m:
                        return int(m.group())
            return 9999
        families[fid]["chil"].sort(key=born)

    def join_family(fid, pid, as_child):
        rec = people[pid]
        (rec["famc"] if as_child else rec["fams"]).append(fid)

    for pid in DETACH:
        if have(pid, "detach"):
            for fid in people[pid]["famc"]:
                families[fid]["chil"].remove(pid)
            people[pid]["famc"] = []

    for f in NEW_FAMILIES:
        if not all(have(x, "new family") for x in [f["husb"], f["wife"], *f["chil"]] if x):
            continue
        clash = [c for c in f["chil"] if people[c]["famc"]]
        if clash:
            warnings.append(f"{f['id']}: {', '.join(people[c]['name'] for c in clash)} already has parents")
            continue
        families[f["id"]] = {"husb": f["husb"], "wife": f["wife"], "chil": f["chil"], "events": []}
        for x in (f["husb"], f["wife"]):
            if x:
                join_family(f["id"], x, False)
        for c in f["chil"]:
            join_family(f["id"], c, True)
        if f["marr"]:
            families[f["id"]]["events"].append(ev("MARR", *f["marr"][:2], src=f["marr"][2]))

    for fid, role, pid in SPOUSES:
        f = families.get(fid)
        if not f or f[role]:
            warnings.append(f"{fid}: {'no such family' if not f else role + ' already set'}; skipped {people[pid]['name']}")
            continue
        f[role] = pid
        join_family(fid, pid, False)

    for fid, pids in CHILDREN:
        f = families.get(fid)
        if not f:
            warnings.append(f"{fid}: no such family")
            continue
        for pid in pids:
            name = people[pid]
            if any(first_word(people[c]["name"]) == first_word(name["name"]) and people[c]["surname"] == name["surname"]
                   for c in f["chil"]):
                warnings.append(f"{fid}: {name['name']} looks like someone already in the family; skipped")
                continue
            f["chil"].append(pid)
            join_family(fid, pid, True)
        sort_children(fid)

    for pid, fid in MOVES:
        if have(pid, "move") and fid in families:
            for old in people[pid]["famc"]:
                families[old]["chil"].remove(pid)
            people[pid]["famc"] = [fid]
            families[fid]["chil"].append(pid)
            sort_children(fid)

    for child, parent in UNLINKS:
        if not (have(child, "unlink") and have(parent, "unlink")):
            continue
        fid = next((x for x in people[child]["famc"] if parent in (families[x]["husb"], families[x]["wife"])), None)
        if not fid:
            warnings.append(f"unlink: {people[parent]['name']} is no longer {people[child]['name']}'s parent")
            continue
        f = families[fid]
        other = f["wife"] if f["husb"] == parent else f["husb"]
        f["chil"].remove(child)
        people[child]["famc"].remove(fid)
        if other:  # keep the right parent in a family of their own
            nid = f"@R-split-{child.strip('@')}@"
            families[nid] = {"husb": other if f["husb"] == other else None,
                             "wife": other if f["wife"] == other else None, "chil": [child], "events": []}
            people[other]["fams"].append(nid)
            people[child]["famc"].insert(0, nid)

    for fid, date, place, src in MARRIAGES:
        f = families.get(fid)
        if not f:
            warnings.append(f"marriage: no family {fid}")
            continue
        e = next((e for e in f["events"] if e["tag"] == "MARR"), None)
        if e:
            if e["date"] and e["date"] != date:
                e["detail"] = "; ".join(x for x in [e["detail"], f"The Ancestry tree has {e['date']}."] if x)
            e.update(date=date, place=place or e["place"], src=e["src"] + [src], res=True)
        else:
            f["events"].append(ev("MARR", date, place, src=src))

    # research sources count alongside Ancestry's
    for p in people.values():
        p["nsrc"] += len({s["t"] for e in p["events"] for s in e["src"] if s.get("r")})
    return warnings
