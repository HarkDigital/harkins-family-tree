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
NEW_PEOPLE, NEW_FAMILIES, SPOUSES, CHILDREN, MOVES, UNLINKS, RENAMES, FIXES, ADDS, DROPS, MARRIAGES, DETACH, GRAVES, \
    REMOVES = ([] for _ in range(14))
# research people and families that have since been entered on Ancestry: @R id -> Ancestry id (filled by apply)
ALIASES = {}


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
note(THOMAS, "His death certificate names his parents as William Harkins and Anna, both born in Philadelphia, and "
             "the 1900 and 1910 censuses show him living with that William. Ancestry used to attach him to William "
             "Andrew Harkins and Jane Fitzpatrick of the Wilmington family, whose children don't include a Thomas.",
     THOMAS_CERT)

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
ANNA = new("@R-anna-harkins@", "Anna", "", "F", src=THOMAS_CERT, bplace="Philadelphia, Pennsylvania, USA")
note(ANNA, "Maiden name unknown. Thomas's death certificate gives it as Garrity, but William's second wife was "
           "Katherine A. Garrity, so the informant may have mixed the two up. Anna wasn't in the 1900 household and "
           "had probably died by then.", THOMAS_CERT)
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
note("@R-bridget-bymer@", "James's death certificate is indexed with her surname as Bymer.", JAMES_CERT)

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
children("@F51@", new("@R-patrick-j-morley@", "Patrick J. Morley", "Morley", "M", "8 Aug 1873", "17 Mar 1911",
                      fag(142641911), ddetail="Drowned in the Delaware River."))

JANE_V = "@I342198309850@"
RENAMES.append((JANE_V, "Jane Veronica Fitzpatrick", "Fitzpatrick"))
fix(JANE_V, "BIRT", fag(113142246), date="2 Jul 1862")
add(JANE_V, "BURI", fag(113142246), place="St. Dominic Cemetery, Holmesburg, Philadelphia, Pennsylvania, USA",
    detail="Sec. L, Range 11, Lot 68, under a family stone.")
fix("@I342198309846@", "BURI", fag(113142270), place="St. Dominic Cemetery, Holmesburg, Philadelphia, Pennsylvania, USA",
    detail="Same lot as his wife Jane.")
MARRIAGES.append(("@F2@", "1887", "", fag(113142270)))
add("@I342198431751@", "BURI", fag(113143716), place="St. Joachim Cemetery, Philadelphia, Pennsylvania, USA",
    detail="Buried with his wife Jane.")

# Jane Trainor and the rest of John Fitzpatrick's children (her memorial lists all seven)
spouse("@F34@", "wife", new("@R-jane-trainor@", "Jane Trainor", "Trainor", "F", "May 1829", "27 Dec 1905",
                            fag(25658504), "Ireland", "Philadelphia, Pennsylvania, USA",
                            "St. Joachim Cemetery, Philadelphia, Pennsylvania, USA"))
children("@F34@", *[new(f"@R-fitzpatrick-{i}@", name, "Fitzpatrick", sex, b, d, fag(25658504)) for i, (name, sex, b, d) in
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
    new("@R-philomena-perret@", "Philomena Perret", "Perret", "F", "Dec 1891", src=H1900),
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
add("@I342198309705@", "RESI", S1910, "1910", "Scranton Ward 11, Lackawanna, Pennsylvania, USA",
    "Listed as Helen M., age 6, with her parents and sisters May and Ruth.")
children("@F33@", new("@R-may-schuler@", "May Schuler", "Schuler", "F", "abt 1906", src=S1910),
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
# his memorial prayer card, photographed by Mike (7 Nov 2026; the photo is in docs/media/added/)
ABRAHAM_CARD = cite("Memorial card of Abraham Edward Henwood (Franciscan Missionary Union, Chicago), from Mike Harkins")
fix(ABRAHAM_E, "BIRT", ABRAHAM_CARD, match="abt 1885", date="15 Feb 1885")
add(ABRAHAM_E, "DEAT", ABRAHAM_CARD, "28 Jun 1937")
children("@F21@", *[new(f"@R-henwood-{i}@", name, "Henwood", sex, b, d, fag(23739043)) for i, (name, sex, b, d) in
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
# Mike, 7 Nov 2026: "Jr" rather than "Junior", as the export has it
RENAMES.append(("@I342198307183@", "Glen A. Dymond Jr.", "Dymond"))
fix(GLEN_SR, "BIRT", fag(122060799), place="Lockville, Wyoming County, Pennsylvania, USA")
add(GLEN_SR, "RESI", cite("Raleigh city directory, 1949 (archive.org)"), "1949", "Raleigh, North Carolina, USA",
    "Worked at the Mother & Daughter store.")
add(GLEN_SR, "RESI", cite("Asheville city directory, 1956 (archive.org)"), "1956", "Asheville, North Carolina, USA",
    "45 Henrietta St.; worked at Belk's.")
add(GLEN_SR, "BURI", fag(122060799), place="Pisgah View Memorial Park, Candler, North Carolina, USA")
MARRIAGES.append(("@F78@", "1923", "", fag(122060799)))
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
MOVES.append((JEAN, "@F78@"))
fix(JEAN, "BIRT", fag(188328785), date="1924")
add(JEAN, "DEAT", fag(188328785), "2021", detail="As Jean Dymond Burgess.")

WAYMAN = "@I342198310990@"
DROPS.append((WAYMAN, "DEAT", "ABT 1940"))
MARRIAGES.append(("@F75@", "28 Sep 1887", "Vernon, Wyoming County, Pennsylvania, USA", DYMOND_1981))
add(WAYMAN, "OCCU", cite("Scranton Tribune, 1897"), "1897", detail="Butcher.")
add(WAYMAN, "RESI", cite("Scranton Tribune, 1899"), "1899", "Moosic, Lackawanna, Pennsylvania, USA")
add(WAYMAN, "EVEN", DYMOND_1981, "24 Apr 1909", detail="The family farm was sold at sheriff's sale.", label="Farm sold")
add(WAYMAN, "RESI", DYMOND_1981, "abt 1915", "Punxsutawney, Pennsylvania, USA",
    "Ran a store there after leaving the family. The family genealogy says his final whereabouts are not known; "
    "the “about 1940” death on Ancestry has no source.")
children("@F75@", *[new(f"@R-glen-bro-{i}@", name, "Dymond", "M", b, d, WAYMAN_FAG) for i, (name, b, d) in
                    enumerate([("Leo Earle Dymond", "1888", "1976"), ("Howard W. Dymond", "1890", "1893"),
                               ("Ernest Dymond", "1892", "1895"), ("Russell Sage Dymond", "1894", "1972"),
                               ("Harold Dymond", "1896", "1897")])])
children("@F95@", *[new(f"@R-wayman-sib-{i}@", name, "Dymond", sex, b, d, WAYMAN_FAG) for i, (name, sex, b, d) in
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
children("@F23@", *[new(f"@R-eggleston-{i}@", name, "Eggleston", sex, b, d, EGGLESTON_FAG) for i, (name, sex, b, d) in
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
note(MARY_BOOTH, "Probably a daughter of Martin Luther Booth, as Ancestry hints have it: her grandson was named "
                 "Martin Luther Dymond.")
note(MARY_BOOTH, "Ancestry used to list Sarah Booth (1770–1840) of Farmington, Connecticut, as her mother. Sarah lived and "
                 "died in Connecticut, so she and the Booth, Hollister and Treat ancestors above her are left off "
                 "this site.", cite("Jacobus, The Booth Family (1952)"))

# ---------------------------------------------------------------- colonial Connecticut, Alsace

POLLY = "@I342217257419@"
RENAMES.append((POLLY, "Polly Strong", "Strong"))
fix(POLLY, "BIRT", DWIGHT, date="23 Jan 1786", detail="Twin of Dolly.")
family("@R-strong@", new("@R-john-strong@", "Rev. John Strong", "Strong", "M", "1755", "1836", DWIGHT),
       new("@R-lydia-thomas@", "Lydia Thomas", "Thomas", "F", "1758", "1840", DWIGHT), [POLLY])

spouse("@F63@", "wife", new("@R-susannah-downs@", "Susannah Downs", "Downs", "F", src=BAILEY))
MARRIAGES.append(("@F63@", "10 Sep 1778", "Weston, Fairfield, Connecticut, USA", BAILEY))
RENAMES += [("@I342219650769@", "Joseph Whitlock", "Whitlock"), ("@I342219650814@", "Joseph Whitlock", "Whitlock")]

MARY_JARVIS = "@I342219650888@"
add(MARY_JARVIS, "EVEN", BAILEY, "17 Oct 1760", "Weston, Fairfield, Connecticut, USA", "To John Thorp of Norwalk.",
    label="Remarried")
UNLINKS.append((MARY_JARVIS, "@I342219650910@"))
note(MARY_JARVIS, "Ancestry lists Rebecca Parkman, who was born and died in England, as her mother; that link is "
                  "left off this site.")

THOMAS_W = "@I342219650827@"
fix(THOMAS_W, "BIRT", JACOBUS, date="abt 1690", detail="The 6 Mar 1693 date on Ancestry has no source.")
MARRIAGES.append(("@F67@", "24 Jan 1715/16", "Fairfield, Connecticut, USA", cite("Barbour Collection, Fairfield")))
family("@R-whitlock@", new("@R-john-whitlock@", "John Whitlock", "Whitlock", "M", died="1698",
                           dplace="Fairfield, Connecticut, USA",
                           src=cite("Jacobus, via WikiTree; Lineage Book (1923)")),
       new("@R-sarah-sherwood@", "Sarah Sherwood", "Sherwood", "F", src=cite("Jacobus, via WikiTree; Lineage Book (1923)")),
       [THOMAS_W])
family("@R-hide@", new("@R-john-hide@", "John Hide", "Hide", "M", "1668", "1744", SCHENCK),
       new("@R-rachel-rumsey@", "Rachel Rumsey", "Rumsey", "F", "1671", "1738", SCHENCK), ["@I342219650855@"])

spouse("@F47@", "wife", new("@R-anne-mosher@", "Anne Mosher", "Mosher", "F", "1745", "abt 1832",
                            cite("Wilsey; Pedigrees of Colonial Clergy; Doherty, via WikiTree"),
                            "Dartmouth, Massachusetts, USA", "Woodstock, Ulster, New York, USA"))

AMOS = "@I342219650927@"
fix(AMOS, "BIRT", cite("Vernon Cemetery transcription"), date="abt 1793",
    detail="His gravestone gives his age as 68 in 1861.")
note(AMOS, "Ancestry lists Mary Brown (1777–1854) as his mother. She'd have been about 15 and died in Ontario, "
           "so that link is left off this site.")

WERKHEISER = "@I342219650996@"
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
MARRIAGES.append(("@F51@", "abt 1873", "", M1900))
children("@F51@", new("@R-michael-morley-1878@", "Michael Morley", "Morley", "M", "abt 1878", src=M1900),
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

# ---------------------------------------------------------------- deep search, Find a Grave
# Read late on 6 Nov 2026, when the browser couldn't be used for Ancestry. Each memorial was checked against
# its own text and tied to the right person by exact dates and family names.

# Helen Schuler was Helen Carney: Fred's memorial links her, and their daughter Mary's obituary names her
HELEN_S = "@I342198310928@"
HELEN_CERT = pa_death(106902, 1953, 5923500)
HELEN_FAG = fag(234328323)
MAY_FAG = fag(46934880, ", with her 2004 obituary")
add(FRED, "BURI", fag(193965501), place="Dunmore Cemetery, Dunmore, Lackawanna, Pennsylvania, USA")
RENAMES.append((HELEN_S, "Helen Carney", "Carney"))
fix(HELEN_S, "BIRT", HELEN_CERT, date="17 Mar 1878", place="Ireland",
    detail="Her daughter Marjorie's 1929 New York death certificate also gives Ireland.")
DROPS.append((HELEN_S, "BIRT", ""))  # Ancestry's undated Ireland birth, now folded into the one above
add(HELEN_S, "DEAT", HELEN_CERT, "25 Dec 1953", "Scranton, Lackawanna, Pennsylvania, USA")
add(HELEN_S, "BURI", HELEN_FAG, place="Dunmore Cemetery, Dunmore, Lackawanna, Pennsylvania, USA",
    detail="Beside her husband Fred.")
note(HELEN_S, "Find a Grave links Fred to his wife Helen Kearney Schuler (1880–1953), buried with him in Dunmore, and "
              "their daughter Mary's 2004 obituary calls her parents Frederick and Helen Karney Schuler. Her own "
              "death certificate, as Helen Schuler, gives her parents as John Carney and Ellen McAweeney.", MAY_FAG)
family("@R-carney@", new("@R-john-carney@", "John Carney", "Carney", "M", src=HELEN_CERT),
       new("@R-ellen-mcaweeney@", "Ellen McAweeney", "McAweeney", "F", src=HELEN_CERT), [HELEN_S])
for pid in ("@R-john-carney@", "@R-ellen-mcaweeney@"):
    note(pid, "Named as Helen Carney's parent on her 1953 death certificate.", HELEN_CERT)

MAY = "@R-may-schuler@"
RENAMES.append((MAY, "Mary E. “May” Schuler Tyler", "Schuler"))
DROPS.append((MAY, "BIRT", "abt 1906"))
add(MAY, "BIRT", MAY_FAG, "31 Dec 1905", "Scranton, Lackawanna, Pennsylvania, USA",
    "May in the 1910 census; her obituary says she was born and educated in Scranton.")
add(MAY, "OCCU", MAY_FAG, detail="Retired operator for IBM in New Jersey.")
add(MAY, "DEAT", MAY_FAG, "25 Feb 2004", "Saratoga County, New York, USA",
    "At Saratoga Hospital. She lived in Malta, New York, and before that in St. Augustine, Florida.")
add(MAY, "BURI", MAY_FAG, place="San Lorenzo Cemetery, St. Augustine, Florida, USA")
note(MAY, "Married William Henry Tyler Sr. (1905–1987) in 1927.", MAY_FAG)
children("@F33@",
         new("@R-rita-schuler@", "Rita Margaret Schuler", "Schuler", "F", "6 Jun 1919", "9 Oct 1990", HELEN_FAG,
             "Scranton, Lackawanna, Pennsylvania, USA"),
         new("@R-robert-schuler@", "Robert Paul Schuler", "Schuler", "M", "3 Mar 1922", "18 Dec 2002", fag(234328187),
             "Pennsylvania, USA", "Scranton, Lackawanna, Pennsylvania, USA",
             "Cathedral Cemetery, Scranton, Pennsylvania, USA"))

# Perret: a daughter who died young, and Henry Eugene's probable death in 1904
HENRIETTA_FAG = fag(185978573)
children("@R-perret@", new("@R-henrietta-perret@", "Henrietta M. Perret", "Perret", "F", "Mar 1890", "6 Jun 1892",
                           HENRIETTA_FAG, "Philadelphia, Pennsylvania, USA", "Philadelphia, Pennsylvania, USA",
                           "Most Holy Redeemer Cemetery, Philadelphia, Pennsylvania, USA"))
note("@R-henrietta-perret@", "Find a Grave, citing her death certificate and the cemetery's burial log, names her "
                             "parents as Eugene and Eugenia Perret of Garden St. She'd be the fifth child Eugenia "
                             "counted in 1900, the one no longer living.", HENRIETTA_FAG)
note(HENRY, "Probably the Eugene Perret, an engraver, who died in Philadelphia on 16 Jun 1904 and is buried in Most "
            "Holy Redeemer Cemetery, in lot B-3-61 with Melanie Victoria Buchy (1890–1892), daughter of Henry and "
            "Apolonia Buchy. Find a Grave gives his birth as 1856 in Germany and his home as Avenue F below 8th St. A "
            "death in 1904 would explain why he's missing from the 1910 census, with his son Alphonse in a "
            "children's home.", fag(91976852))
add(JOSEPH_P, "BURI", fag(248220581), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA",
    detail="Find a Grave gives his birth as 23 Mar 1894, the year the 1900 census gives.")
MARY_P = "@I342198310489@"
MARY_P_FAG = fag(248220586)
fix(MARY_P, "BIRT", MARY_P_FAG, date="20 Aug 1898", place="Philadelphia, Pennsylvania, USA")
add(MARY_P, "DEAT", MARY_P_FAG, "27 Oct 1976", "Camden County, New Jersey, USA")
add(MARY_P, "BURI", MARY_P_FAG, place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA", detail="With her husband Joseph.")

# Martin: Mary's father, from her memorial's family links, and her brothers and sisters
EUGENE_M_FAG = fag(242829149)
spouse("@F73@", "husb", new("@R-eugene-martin@", "Eugene Joseph Martin", "Martin", "M", "22 Feb 1869", "12 Apr 1960",
                            EUGENE_M_FAG, "Philadelphia, Pennsylvania, USA", "Philadelphia, Pennsylvania, USA",
                            "Holy Cross Cemetery, Yeadon, Pennsylvania, USA"))
MARRIAGES.append(("@F73@", "1898", "", EUGENE_M_FAG))
note("@R-eugene-martin@", "Named as Mary Martin Perret's father and Mary Ann McAvoy's husband by Find a Grave's family "
                          "links. Not yet checked against a census or Mary's 1919 marriage license application.",
     MARY_P_FAG)
add(MCAVOY, "BURI", fag(242829282), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA")
note(MCAVOY, "Find a Grave gives her birth as 25 Jul 1877; her death certificate gives 26 Jul 1880.", fag(242829282))
children("@F73@", *[new(f"@R-martin-{i}@", name, "Martin", sex, b, d, EUGENE_M_FAG) for i, (name, sex, b, d) in
                    enumerate([("James Thomas Martin", "M", "1906", "1966"), ("Sally E. Martin Bradley", "F", "1913", "1980"),
                               ("Francis Martin", "M", "1916", "1916"), ("Margaret Martin Sanders", "F", "1917", "1999")])])
add("@R-margaret-mcavoy@", "BURI", fag(162124704), place="Holy Cross Cemetery, Yeadon, Pennsylvania, USA",
    detail="Plot Q-13-49-2.")

# ---------------------------------------------------------------- deep search, directories and Mike's lookups
# Also late on 6 Nov 2026: the Philadelphia directories on archive.org (McElroy's 1855–1867, Gopsill's 1871), and
# records Mike looked up in Ancestry himself, since the app wouldn't let Claude use it. Each checked against its own text.

OYSTERMAN = cite("Philadelphia directories: McElroy's 1857 and 1867, Gopsill's 1871 (archive.org)",
                 "https://archive.org/details/gopsillsphiladel00cost")
note("@R-william-harkins-sr@", "Probably the William Harkins listed as an oysterman on Front St. above Mifflin in 1857, "
                               "a laborer at 1846 S. Front St. in 1867 and selling oysters at Moore and S. Front Sts. "
                               "in 1871. McClellan St., where his son William lived in 1910, runs west from 1818 S. "
                               "Front. Directories don't name wives or children, so a census still has to confirm it.",
     OYSTERMAN)
DRAFT_1917 = cite("World War I draft registration card of Joseph H. Perret, Philadelphia local board 42 (Ancestry)")
add(JOSEPH_P, "EVEN", DRAFT_1917, "1917–1918", "2236 S. 69th St., Philadelphia, Pennsylvania, USA",
    "Single; slender and of medium height, with dark brown hair and blue eyes. The card gives his birth as 23 Mar "
    "1895 in Pennsylvania, as his death certificate does.", label="World War I draft registration")

# ---------------------------------------------------------------- Mike's lookups, second round
# 7 Nov 2026: four more of Mike's Ancestry searches. He sent the results pages, not the records, so these rest on
# Ancestry's index entries, each checked against what's already known.

DRAFT_1942 = cite("World War II draft registration of Joseph Henry Perret, 1942 (Ancestry's index)")
add(JOSEPH_P, "EVEN", DRAFT_1942, "1942", "Philadelphia, Pennsylvania, USA",
    "Registered as Joseph Henry Perret, born in Philadelphia. The index gives his birth as 3 Mar 1895; his World War "
    "I card and death certificate say 23 Mar.", label="World War II draft registration")
note(HENRY, "Probably the Eugene Perret, born about 1858 in Switzerland, in New York City in the 1880 census. Ancestry "
            "finds no other Eugene Perret of his age in it, and Henry came to the United States in 1880. Only the "
            "census index has been seen, not the page.",
     cite("1880 U.S. census, New York City (index entry for Eugene Perret, Ancestry)"))

# ---------------------------------------------------------------- free sources, second pass
# 7 Nov 2026: Find a Grave and archive.org's full-text search, for the research leads on the site. Mostly they
# ruled things out (Batch 10 of the evidence file); the one addition is a published source for Mary Booth's death.

CLERGY_1987 = cite("Pedigrees of Descendants of the Colonial Clergy (1987), Dymond lineage (archive.org full-text "
                   "search)", "https://archive.org/details/pedigreesofdesce0000unse")
fix(MARY_BOOTH, "DEAT", CLERGY_1987, detail="A 1987 published lineage gives the same date and place, and her birth "
                                            "as 1799 in New York.")

# ---------------------------------------------------------------- Helen Harkins and Stephen Dymond
# 7 Nov 2026, at Mike's request: more on his grandfather Thomas Jr.'s sister Helen, mostly from the free 1950 census,
# and his uncle Stephen, who has died. Stephen's obituary names his widow, children and grandchildren, so only his
# own birth, work and death are taken from it, not his homes.

HELEN_H = "@I342198302221@"
HELEN_SSDI = cite("U.S. Social Security Death Index", "https://www.ancestry.com/search/collections/3693/records/70499057")
H1940 = census(1940, "Philadelphia, ED 51-1361, sheet 8B", 22949872, 2442)
C1950 = cite("1950 U.S. census, Philadelphia, ED 51-1819, sheet 5 (National Archives)",
             "https://1950census.archives.gov/search/?county=Philadelphia&ed=51-1819&name=Harkins&page=1&size=20&state=PA")
ETTING = "1529 S. Etting St., Philadelphia, Pennsylvania, USA"
fix(HELEN_H, "BIRT", HELEN_SSDI, date="15 Dec 1914", detail="New Jersey's death index gives the same date.")
add(HELEN_H, "OCCU", H1940, "1940", detail="An operator in government work, 40 hours a week; she earned $750 in 1939 "
                                           "and had finished four years of high school.")
add(HELEN_H, "RESI", C1950, "1950", ETTING, "Single, with her widowed mother.")
add(HELEN_H, "OCCU", C1950, "1950", detail="Bookkeeping-machine operator for the Army's Quartermaster Corps, 40 hours "
                                           "a week.")
fix(HELEN_H, "DEAT", HELEN_SSDI, detail="Her Social Security record gives her last home as Vineland, Cumberland County.")
add("@I342198302220@", "RESI", C1950, "1950", ETTING,
    "Widowed and keeping house, with her daughter Helen. The census gives her age as 59.")

STEPHEN = "@I342198741672@"
STEPHEN_OBIT = cite("Stephen Dymond's obituary, Earle Funeral Home (2023)",
                    "https://www.earlefuneralhome.com/obituary/stephen-dymond")
add(STEPHEN, "BIRT", STEPHEN_OBIT, "17 Dec 1951", "Camden, Camden, New Jersey, USA")
add(STEPHEN, "OCCU", STEPHEN_OBIT, detail="Worked for UPS for 25 years, until he retired.")
add(STEPHEN, "DEAT", STEPHEN_OBIT, "6 Mar 2023", detail="Aged 71.")
note(STEPHEN, "The Newspapers.com index entry under his name is from the Courier-Post of 9 May 2017, two days after "
              "his father Glen died, so it comes from Glen's obituary, which lists him among Glen's children.")

# ---------------------------------------------------------------- Mike's first cousins
# Names from Mike, 7 Nov 2026. All living, so the public site shows names and relationships only.
# Mariann Dymond married Gerard Harkins, so their three children are cousins on both sides.
def cousins(fid, husb, wife, surname, *kids):
    family(fid, husb, wife, [new(f"@R-cousin-{re.sub(r'[^a-z]+', '-', n.lower())}-{surname.lower()}@",
                                 re.sub(r"^(.*?)( Jr\.)?$", rf"\1 {surname}\2", n), surname, sex) for n, sex in kids])


cousins("@R-fam-gerard-mariann@", "@I342199506710@", "@I342198741674@", "Harkins",
        ("Bryan", "M"), ("Jeffrey", "M"), ("Michelle", "F"))
cousins("@R-fam-francis-dymond@", "@I342198741678@", None, "Dymond",
        ("Francis Jr.", "M"), ("Christin", "F"), ("Brandon", "M"))
cousins("@R-fam-janice-spiritoso@", None, "@I342198741675@", "Spiritoso", ("Jonathan", "M"), ("Michael", "M"))
cousins("@R-fam-janice-mccann@", None, "@I342198741675@", "McCann", ("Magdalene", "F"), ("Sean", "M"))
cousins("@R-fam-john-dymond@", "@I342198741679@", None, "Dymond",
        ("Meghan", "F"), ("Patrick", "M"), ("John Jr.", "M"), ("Maureen", "F"))
cousins("@R-fam-joseph-dymond@", "@I342198741671@", None, "Dymond", ("Colleen", "F"), ("Lauren", "F"))
cousins("@R-fam-michael-dymond@", "@I342198741680@", None, "Dymond", ("James", "M"), ("Michael", "M"))
cousins("@R-fam-robert-dymond@", "@I342823104436@", None, "Dymond",
        ("Phillip", "M"), ("John", "M"), ("Jaquline", "F"), ("Danielle", "F"))
cousins("@R-fam-stephen-dymond@", "@I342198741672@", None, "Dymond", ("Christine", "F"), ("Stephen Jr.", "M"))
cousins("@R-fam-theresa-barner@", None, "@I342198741670@", "Barner", ("Jessica", "F"), ("Sara", "F"))
cousins("@R-fam-thomas-dymond@", "@I342198741676@", None, "Dymond",
        ("Donna", "F"), ("Jennifer", "F"), ("Glen", "M"))


# ---------------------------------------------------------------- Mike's grandmother's sister
# 7 Nov 2026: Mike says his grandmother Margaret Henwood had a sister Veronica. The 2012 obituary of their sister
# Sr. Agnes Edward Henwood lists a Veronica Mosley among the sisters who had died.
AGNES_EDWARD_OBIT = cite("Catholic Star Herald, 20 Dec 2012, obituary of Sr. Agnes Edward Henwood, O.P.",
                         "https://catholicstarherald.org/dominican-sister-agnes-edward-henwood-101-dies/")
VERONICA = new("@R-veronica-henwood@", "Veronica Henwood Mosley", "Henwood", "F", src=AGNES_EDWARD_OBIT,
               ddetail="Before 15 Dec 2012: her sister Sr. Agnes Edward's obituary lists her, as Veronica Mosley, "
                       "among the sisters who had died.")
children("@F46@", VERONICA)
note(VERONICA, "Margaret Henwood's sister, from Mike Harkins. A photo shared on Ancestry shows her as a baby with her "
               "parents, who look to be in their early twenties, so she was probably one of the eldest children.")

# ---------------------------------------------------------------- Ancestry hints, 7 Nov 2026
# Mike accepted Ancestry hints that brought in some 80 earlier ancestors, mostly from other members' trees. They're
# kept, with their names tidied, except where they're plainly wrong.
RENAMES += [
    ("@I342823252421@", "Dennis Meraugh", "Meraugh"),  # also Merraugh, Morrough, Meroth, Mero
    ("@I342823252478@", "Dennis Meraugh", "Meraugh"),  # also Manross
    ("@I342823252559@", "Denis Meraugh", "Meraugh"),
    ("@I342823252586@", "Jane Marroh", "Marroh"),
    ("@I342823252389@", "Sarah Meraugh", "Meraugh"),
    ("@I342823252436@", "Abigail Ayer", "Ayer"),
    ("@I342823252527@", "Sarah Corliss", "Corliss"),
    ("@I342823253163@", "Rachel Sampson", "Sampson"),
    ("@I342823250709@", "Richard Norman", "Norman"),
    ("@I342823252208@", "Miriam Robbins", "Robbins"),
    ("@I342823253055@", "Rachel Rumsey", "Rumsey"),
    ("@I342823253083@", "Rachel Frost", "Frost"),
    ("@I342823253211@", "Dorcas Barker", "Barker"),
    ("@I342823253242@", "Kesiah Kessager", "Kessager"),
    ("@I342823249928@", "Margaret Harrison", "Harrison"),
    ("@I342823250258@", "Margery Wilding", "Wilding"),
    ("@I342823250591@", "Patrick Scott", "Scott"),
    ("@I342823250303@", "Patrick Schott", "Schott"),
    ("@I342823253453@", "Ruth Geer", "Geer"),
    ("@I342823249990@", "Elizabeth McLaughlin", "McLaughlin"),
]
# John Hide's mother Ann, daughter of Sir William Inglebie of Ripley Castle. Mike asked on 9 Nov 2026 for the Ingleby
# line to stay in, like the other hint ancestors; Ancestry has her surname as "Ripley", the castle.
RENAMES += [("@I342823252900@", "Ann Inglebie", "Inglebie"),
            ("@I342823252960@", "Sir William Inglebie, Baron of Ripley", "Inglebie")]
# The hints made a second Matthew Dymond (1740) and Anna Mosher, with their own copy of the Mosher line, as Mary
# Dymond's parents. She belongs with Matthew Dymond Sr. and Anne Mosher.
MOVES.append(("@I342217257458@", "@F47@"))
# John M Strong came with three births: 7 May 1755 at Durham (as Dwight has him), a bare 1755, and 28 May 1760 at East
# Windsor twice. The last two go.
JOHN_STRONG = "@I342823252369@"
DROPS += [(JOHN_STRONG, "BIRT", "1755"), (JOHN_STRONG, "BIRT", "28 May 1760")]
note(JOHN_STRONG, "The Ancestry tree also gives a birth of 28 May 1760 at East Windsor, Connecticut, which doesn't fit "
                  "Dwight's 1755. His parents Enoch Strong and Sarah Meraugh come from other members' trees.")
DROPS.append(("@I342198785508@", "BIRT", "Jun 1854"))  # Margaret Roarty: a second, less exact copy of her birth

# ---------------------------------------------------------------- Mike's aunts' married names, 7 Nov 2026
# From Mike. All living, so the public site shows names and relationships only. The McCann and Barner children
# are put with Jack and CJ by their surnames.
RENAMES += [("@I342199506709@", "Marianne R. Harkins Matlack", "Harkins"),
            ("@I342198741675@", "Janice Dymond McCann", "Dymond"),
            ("@I342198741670@", "Theresa Dymond Barner", "Dymond"),
            ("@I342198741674@", "Mariann Dymond Barner", "Dymond")]
family("@R-fam-marianne-richard@", new("@R-richard-matlack@", "Richard Matlack", "Matlack", "M"), "@I342199506709@")
family("@R-fam-janice-jack@", new("@R-jack-mccann@", "Jack McCann", "McCann", "M"), "@I342198741675@")
MOVES += [("@R-cousin-magdalene-mccann@", "@R-fam-janice-jack@"), ("@R-cousin-sean-mccann@", "@R-fam-janice-jack@")]
spouse("@R-fam-theresa-barner@", "husb", new("@R-cj-barner@", "CJ Barner", "Barner", "M"))
# Mariann's second husband; her children Bryan, Jeffrey and Michelle stay with Gerard M. Harkins
family("@R-fam-mariann-carl@", new("@R-carl-barner@", "Carl Barner", "Barner", "M"), "@I342198741674@")

# ---------------------------------------------------------------- From Mike, 7 Nov 2026 (later)
# Glen Jr.'s half brothers. Mike gave only the names; they're put with Glen Sr. and his second wife Effie, and
# treated as possibly living (no dates). Glen Jr.'s sister Marjorie is H Marjorie Dymond, already in @F78@.
children("@R-glen-effie@", new("@R-russell-dymond@", "Russell Dymond", "Dymond", "M"),
         new("@R-martin-dymond@", "Martin Dymond", "Dymond", "M"))
# Mike's Harkins cousins' spouses. Molly's and Gretchen's maiden names aren't known.
family("@R-fam-bryan-molly@", "@R-cousin-bryan-harkins@", new("@R-molly-harkins@", "Molly Harkins", "", "F"))
family("@R-fam-jeffrey-gretchen@", "@R-cousin-jeffrey-harkins@",
       new("@R-gretchen-harkins@", "Gretchen Harkins", "", "F"))
children("@R-fam-bryan-molly@", *[new(f"@R-{n.lower()}-harkins@", f"{n} Harkins", "Harkins", sex)
                                 for n, sex in [("Kelsey", "F"), ("Drew", "M"), ("Sophie", "F")]])
# Mike said "Jeffrey's children"; they're put with Gretchen as well
children("@R-fam-jeffrey-gretchen@", *[new(f"@R-{n.lower()}-harkins@", f"{n} Harkins", "Harkins", sex)
                                      for n, sex in [("Isla", "F"), ("Liam", "M")]])
RENAMES.append(("@R-cousin-michelle-harkins@", "Michelle Harkins Larrabee", "Harkins"))
family("@R-fam-michelle-david@", new("@R-david-larrabee@", "David Larrabee", "Larrabee", "M"),
       "@R-cousin-michelle-harkins@")

# ---------------------------------------------------------------- living relatives' birth years, 10 Nov 2026
# Looked up on Ancestry one search at a time. The cousins on Ancestry got their births there; these are the
# research-only people. Public-records months come from the index (month and year only).
PUBLIC_RECORDS = cite("U.S. Index to Public Records, 1994–2019 (Ancestry)",
                      "https://www.ancestry.com/search/collections/62209/")
NJ_MARRIAGES = cite("New Jersey, U.S., Marriage Index, 1901–2016 (Ancestry)",
                    "https://www.ancestry.com/search/collections/61253/")
RENAMES += [("@R-molly-harkins@", "Molly Luther Harkins", "Luther"),
            ("@R-cj-barner@", "Carl J. “CJ” Barner", "Barner"),
            ("@R-carl-barner@", "Carl H. Barner", "Barner"),
            ("@R-richard-matlack@", "Richard Harold Matlack", "Matlack"),
            ("@R-jack-mccann@", "John P. “Jack” McCann", "McCann")]
add("@R-molly-harkins@", "BIRT", PUBLIC_RECORDS, "Oct 1970")
add("@R-cj-barner@", "BIRT", PUBLIC_RECORDS, "Nov 1961")
add("@R-carl-barner@", "BIRT", PUBLIC_RECORDS, "Mar 1939")
add("@R-richard-matlack@", "BIRT", PUBLIC_RECORDS, "Feb 1942")
MARRIAGES += [("@R-fam-bryan-molly@", "12 Dec 1992", "Barrington, Camden, New Jersey, USA", NJ_MARRIAGES),
              ("@R-fam-theresa-barner@", "8 Jul 1989", "Barrington, Camden, New Jersey, USA", NJ_MARRIAGES),
              ("@R-fam-mariann-carl@", "5 Sep 1987", "Barrington, Camden, New Jersey, USA", NJ_MARRIAGES),
              ("@R-fam-marianne-richard@", "21 May 2006", "Medford Township, Burlington, New Jersey, USA",
               NJ_MARRIAGES),
              ("@R-fam-janice-jack@", "Jun 1982", "Pennsauken, Camden, New Jersey, USA", NJ_MARRIAGES),
              ("@R-fam-janice-spiritoso@", "Dec 1974", "Camden, Camden, New Jersey, USA", NJ_MARRIAGES)]
# Janice's first husband, father of Jonathan and Michael Spiritoso
spouse("@R-fam-janice-spiritoso@", "husb", new("@R-giuseppe-spiritoso@", "Giuseppe Spiritoso", "Spiritoso", "M"))

# Glen Sr.'s sons with Effie: both have died
NC_MARRIAGES = cite("North Carolina, U.S., Marriage Records, 1741–2011 (Ancestry)")
RENAMES += [("@R-russell-dymond@", "Russell Lee Dymond", "Dymond"),
            ("@R-martin-dymond@", "Martin Thomas Dymond", "Dymond")]
MEMBER_TREES = cite("Other members' trees and photos on Ancestry (Bess/Jenkins Family Tree)")
add("@R-russell-dymond@", "BIRT", MEMBER_TREES, "Jan 1941", "South Carolina, USA")
add("@R-russell-dymond@", "RESI", cite("1950 U.S. census (Ancestry index)"), "1950",
    "Camden, Kershaw, South Carolina, USA", "With his parent G. A. Dymond.")
add("@R-russell-dymond@", "DEAT", MEMBER_TREES, "8 May 2016", "Charlotte, Mecklenburg, North Carolina, USA",
    "From other members' trees; the Newspapers.com obituary index has an entry for him.")
family("@R-fam-russell-linda@", "@R-russell-dymond@",
       new("@R-linda-simpson@", "Linda Sue Simpson", "Simpson", "F"),
       marr=("8 Aug 1964", "Gaston, North Carolina, USA", NC_MARRIAGES))
note("@R-russell-dymond@", "His marriage record names his parents as Glenn Austin Dymond and Effie Orean Truedale. "
                           "A newspaper marriage notice of 23 Aug 1964 gives him as of Winchester, Virginia.",
     NC_MARRIAGES)
SS_CLAIMS = cite("U.S., Social Security Applications and Claims Index, 1936–2007 (Ancestry)")
add("@R-martin-dymond@", "BIRT", SS_CLAIMS, "27 Feb 1946", "Winston-Salem, Forsyth, North Carolina, USA")
add("@R-martin-dymond@", "DEAT", SS_CLAIMS, "10 Aug 1995")
note("@R-martin-dymond@", "Married 21 Aug 1966, of Presque Isle, Maine, his parent Glen A. Dymond (Newspapers.com "
                          "marriage index; the bride isn't named in the index).")

# ---------------------------------------------------------------- missing dates from Find a Grave, 7 Nov 2026
# Each memorial was checked against the family: it names the same parents (or, for a parent, the same children).


def grave(who, n, born="", bplace="", died="", dplace="", cem=""):
    """Dates, places and burial from Find a Grave memorial n, filled into the person's existing facts (applied last,
    after research copies are merged, so a year from earlier research becomes the full date instead of a second fact)."""
    for tag, date, place in (("BIRT", born, bplace), ("DEAT", died, dplace), ("BURI", "", cem)):
        if date or place:
            GRAVES.append((who, tag, date, place, fag(n)))


PA, NJ = "Pennsylvania, USA", "New Jersey, USA"
HOLY_CROSS = "Holy Cross Cemetery, Yeadon, Pennsylvania, USA"
DYMOND_CEM = "Dymond Cemetery, Exeter, Luzerne County, Pennsylvania, USA"
SUNNYSIDE = "Sunnyside Cemetery, Tunkhannock, Pennsylvania, USA"
LOCKVILLE = "Lockville, Wyoming County, Pennsylvania, USA"

# Emily Tatu Henwood's children
grave("@I342823235718@", 206911124, "Dec 1886", died="2 Mar 1966", dplace="Norristown, Montgomery County, " + PA,
      cem="Saint Patrick Cemetery, Norristown, Pennsylvania, USA")
grave("@I342823235785@", 157184450, "22 Dec 1887", died="23 Mar 1956", dplace="Camden, " + NJ,
      cem="Calvary Cemetery, Cherry Hill, New Jersey, USA")
grave("@I342823235811@", 23739047, "26 Sep 1889", died="9 Dec 1958", cem=HOLY_CROSS)
grave("@I342823235891@", 112444494, "28 Oct 1891", "Rutherford, Bergen County, " + NJ, "22 Aug 1976",
      cem="Cathedral Cemetery, Wilmington, Delaware, USA")
grave("@I342823235944@", 23739042, cem=HOLY_CROSS)
grave("@I342823236009@", 206886335, "1 Jan 1896", NJ, "28 Nov 1980", "Delaware County, " + PA, HOLY_CROSS)
# her brother and sister
grave("@R-emile-tatu@", 14680456, cem=HOLY_CROSS)
fix("@R-elizabeth-tatu@", "BIRT", fag(206909778), date="27 Jul 1866", place="Philadelphia, " + PA)
fix("@R-elizabeth-tatu@", "DEAT", fag(206909778), date="5 May 1944", place="Philadelphia, " + PA)
add("@R-elizabeth-tatu@", "BURI", fag(206909778), place=HOLY_CROSS)
# Abraham R. Henwood's line. His memorial also links a Mary H. Rolling (1881–1940) as his wife; she was 16 when
# he died and his sister married a Rolling, so that link isn't used.
grave("@I342202235339@", 91443606, cem="West Laurel Hill Cemetery, Bala Cynwyd, Pennsylvania, USA")
grave("@I342202235515@", 91443613, cem="West Laurel Hill Cemetery, Bala Cynwyd, Pennsylvania, USA")
add("@I342202235595@", "BURI", fag(78449854), place="Arlington Cemetery, Drexel Hill, Pennsylvania, USA",
    detail="Her 1865 death notice (Philadelphia Inquirer, 8 Apr 1865) says the funeral was to go to Union Cemetery; "
           "she now lies at Arlington.")

# John Booth Dymond and Mary Jane Whitlock's children
grave("@I342823184029@", 73563323, "26 Jun 1846", "Wyoming County, " + PA, "27 Oct 1927",
      "Clarks Summit, Lackawanna County, " + PA, "Benscoter Cemetery, Hunlock Creek, Pennsylvania, USA")
grave("@I342823184099@", 34455983, "22 Sep 1847", PA, "3 Jun 1932", "Young Township, Jefferson County, " + PA,
      "Fitch Cemetery, Falls, Pennsylvania, USA")
grave("@I342823184163@", 114229589, "22 Feb 1849", LOCKVILLE, "10 Mar 1919",
      cem="Hickory Grove Cemetery, Waverly, Pennsylvania, USA")
grave("@I342823184236@", 169098208, "2 Mar 1851", LOCKVILLE, "16 Sep 1938", "Scranton, Lackawanna County, " + PA,
      "Clarks Green Cemetery, Clarks Green, Pennsylvania, USA")
grave("@I342823184292@", 86730286, "8 Oct 1852", LOCKVILLE, "27 Sep 1940", "Burbank, Los Angeles County, California, USA",
      "Valhalla Memorial Park, North Hollywood, California, USA")
grave("@I342823184345@", 34510767, "17 May 1857", "Luzerne County, " + PA, "15 Apr 1858", cem=DYMOND_CEM)
grave("@I342823184401@", 34456497, "24 Nov 1858", "Pittston, Luzerne County, " + PA, "19 Nov 1944",
      "Waymart, Wayne County, " + PA, DYMOND_CEM)
grave("@I342823184436@", 194564138, "13 Feb 1864", LOCKVILLE, cem="Clarks Green Cemetery, Clarks Green, Pennsylvania, USA")
grave("@I342823184479@", 34510724, "5 Mar 1867", "Wyoming County, " + PA, "17 Aug 1868", cem=DYMOND_CEM)
# Wayman and Mary Louise's children
grave("@I342823188489@", 114229418, "22 Sep 1888", died="9 Jun 1976", dplace="Scranton, Lackawanna County, " + PA,
      cem="Hickory Grove Cemetery, Waverly, Pennsylvania, USA")
grave("@I342823188532@", 34510551, cem=DYMOND_CEM)
grave("@I342823188582@", 34510568, cem=DYMOND_CEM)
grave("@I342823188660@", 302407525, "19 Mar 1894", LOCKVILLE, "28 Feb 1972", "Daytona Beach, Volusia County, Florida, USA")
grave("@I342823188736@", 302407849, "21 May 1896", LOCKVILLE, "27 Feb 1897", LOCKVILLE,
      "Fitch Cemetery, Falls, Pennsylvania, USA")
# Glen Sr.'s daughter Jean and his second wife Effie
grave(JEAN, 236109965, "24 Aug 1924", "Scranton, Lackawanna County, " + PA, "3 Oct 2021",
      cem="Silverbrook Cemetery, Wilmington, Delaware, USA")
grave("@I342823189313@", 122060810, "3 Jun 1910", "Kershaw County, South Carolina, USA", "18 Oct 2002",
      "Marion, McDowell County, North Carolina, USA", "Pisgah View Memorial Park, Candler, North Carolina, USA")

# Miles Eggleston and Catherine Werkheiser, and their children
grave("@I342200255170@", 52002218, cem=SUNNYSIDE)
grave("@I342200255196@", 65779290, cem=SUNNYSIDE)
grave("@I342823192037@", 41709530, died="20 Aug 1939", dplace="Center Moreland, Wyoming County, " + PA,
      cem="Fitch Cemetery, Falls, Pennsylvania, USA")
grave("@I342823196819@", 233292754, "6 Feb 1877", "Vernon, Wyoming County, " + PA, "7 Mar 1945",
      "Tunkhannock, Wyoming County, " + PA, SUNNYSIDE)
grave("@I342823206864@", 65780079, "11 Mar 1880", "Vernon, Wyoming County, " + PA, dplace="Meshoppen, Wyoming County, " + PA,
      cem=SUNNYSIDE)
grave("@I342823192116@", 72969293, died="18 Apr 1871", cem="Vernon Cemetery, Vernon, Pennsylvania, USA")

# Eugene Joseph Martin and Mary Ann McAvoy's children
grave("@I342823237233@", 141276773, "15 Jul 1906", "Philadelphia, " + PA, "15 Sep 1966", "Philadelphia, " + PA,
      "Mount Moriah Cemetery, Philadelphia, Pennsylvania, USA")
grave("@I342823237266@", 22896814, "15 May 1913", "Philadelphia, " + PA, "May 1980", "Philadelphia, " + PA, HOLY_CROSS)
grave("@I342823237325@", 243070846, "24 Oct 1916", PA, "12 Nov 1916", "Philadelphia, " + PA, HOLY_CROSS)
grave("@I342823237369@", 242829107, "18 Sep 1917", "Philadelphia, " + PA, "14 Apr 1999",
      "Palm Bay, Brevard County, Florida, USA", "Saints Peter and Paul Cemetery, Springfield, Pennsylvania, USA")

# Mike, 9 Nov 2026: the Edward Henwood (1909-1910) Ancestry attached to Abraham and Agnes from a death certificate
# wasn't one of their children.
REMOVES.append("@I342198785594@")
# Abraham Edward Henwood's children, from Sr. Agnes Edward Henwood's 2012 obituary (survivors left out) and her
# memorial. The 1930 census has an Agnes about 22 and a Florence about 18 at home.
SR_AGNES = fag(188969923, ", with her 2012 obituary")
note("@I342198784184@", "Probably Sister Agnes Edward Henwood, O.P., of the Dominican Sisters of Hope: born 25 Aug 1911 "
                        "in Philadelphia to Abraham Edward and Agnes Dougherty Henwood, died 15 Dec 2012 in New Jersey "
                        "aged 101, buried at the Dominican Sisters Cemetery, Newburgh, New York. Florence, 18 in the "
                        "1930 census, is the daughter whose age fits; a sister often took a religious name.", SR_AGNES)
note("@I342198784190@", "Probably the sister “Agnes Heery” whom Sr. Agnes Edward Henwood's 2012 obituary lists among "
                        "her siblings who had died.", SR_AGNES)
add("@I342198784183@", "DEAT", SR_AGNES, detail="Before 15 Dec 2012: his sister Sr. Agnes Edward's obituary lists him "
                                                "among her siblings who had died.")
note("@I342198784187@", "Sr. Agnes Edward Henwood's 2012 obituary lists a brother “Jerome Joseph” among her siblings "
                        "who had died. It also lists a brother Edward, who isn't in the tree.", SR_AGNES)

# ---------------------------------------------------------------- doubled and impossible facts, 7 Nov 2026
# Ancestry flags these as possible errors. A fact entered twice keeps its fuller copy. Where two unsourced values
# disagree, the one Ancestry shows as preferred stays and the other goes into a note.
DROPS += [("@I342198785791@", "BIRT", "abt 1884"),  # William J Dougherty: Jan 1883 is the census month
          ("@I342200912373@", "BIRT", "1768", "Woodstock, Ulster Co., New York"),
          ("@I342200912373@", "DEAT", "18 Mar 1852", "Franklin, Luzerne, Pennsylvania, United States"),
          ("@I342219651104@", "DEAT", "1735", "Feldbach Kutzenhausen, , Lower Alsace, France"),
          ("@I342823250240@", "BIRT", "1701", ""), ("@I342823250248@", "BIRT", "1702", ""),
          ("@I342823252182@", "BIRT", "1665"), ("@I342823252182@", "DEAT", ""),
          ("@I342823252494@", "BIRT", "1660-1669"),
          ("@I342198310493@", "RESI", "1935"),  # Gene Perret, born 1937: the 1940 census's "where in 1935"
          ("@I342823252208@", "MARR", "1685"),  # Miriam Robbins died in 1683
          ("@I342823250303@", "MARR", "1724")]  # Patrick Schott died in 1714
for who, tag, date, other in [("@I342219651278@", "BIRT", "1740", "1744"), ("@I342823249840@", "BIRT", "May 1840", "1839"),
                              ("@I342823249892@", "BIRT", "Abt 1848", "1 Jan 1853"),
                              ("@I342823249968@", "BIRT", "abt 1852", "about 1855"),
                              ("@I342823250303@", "BIRT", "1665", "7 Sep 1669 at Perth, Scotland"),
                              ("@I342823250591@", "BIRT", "1647", "17 Jun 1628")]:
    DROPS.append((who, tag, date))
    note(who, f"The Ancestry tree also gives a birth of {date.replace('Abt', 'about').replace('abt', 'about')}, "
              f"beside {other}. Neither has a source.")
DROPS += [(JOHN_STRONG, "DEAT", "24 Dec 1831"), (JOHN_STRONG, "DEAT", "30 Jan 1835")]
note(JOHN_STRONG, "The Ancestry tree also gives deaths of 30 Jan 1835 at East Windsor and 24 Dec 1831 at Durham, "
                  "Connecticut, both without sources. Dwight's 1836 is kept.")
DROPS.append(("@I342198784189@", "BIRT", "", "Philadelphia, Pennsylvania"))
note("@I342198784189@", "His death-certificate index gives Philadelphia as his birthplace; the 1930 census gives New York.")

# ---------------------------------------------------------------- apply


TITLES = {"rev", "deacon", "lt", "dr", "sir", "capt", "mr", "mrs"}
ONE_EACH = {"BIRT", "DEAT", "BURI", "CHR", "BAPM", "CREM"}


def year_of(date):
    m = re.search(r"\b(?:1[5-9]\d\d|20\d\d)\b", date or "")
    return m.group() if m else None


def fold(events, e):
    """Add research fact e to a person's events, or fold it into the same fact already there (one entered on
    Ancestry from this research, say): same kind, and the same date or one that only adds detail to it."""
    if e["tag"] == "NOTE":
        if not any(x["tag"] == "NOTE" and x["detail"] == e["detail"] for x in events):
            events.append(e)
        return
    words = lambda d: set(re.sub(r"[^\w]", " ", (d or "").lower()).split())
    twin = next((x for x in events if x["tag"] == e["tag"] and x.get("label") == e.get("label") and not x.get("res") and (
        (year_of(x["date"]) == year_of(e["date"]) and (words(e["date"]) <= words(x["date"]) or words(x["date"]) <= words(e["date"]))
         and (year_of(e["date"]) or e["tag"] in ONE_EACH or x["place"] == e["place"]))
        or (e["tag"] in ONE_EACH and not (year_of(x["date"]) and year_of(e["date"]))))), None)
    if not twin:
        events.append(e)
        return
    longer = lambda a, b: a if len(words(a)) >= len(words(b)) else b
    twin.update(date=longer(twin["date"], e["date"]), place=e["place"] or twin["place"], res=True,
                detail=e["detail"] or re.sub(r"\s*Source: .*$", "", twin["detail"]),
                src=twin["src"] + [s for s in e["src"] if s not in twin["src"]])


def merge(people, families, r, a):
    """Fold research person r into Ancestry person a: research facts win where both have one."""
    rp, ap = people.pop(r), people[a]
    for e in rp["events"]:
        fold(ap["events"], e)
    words = lambda n: re.sub(r"[“”]", '"', n).split()
    if len(words(rp["name"])) > len(words(ap["name"])) and set(words(ap["name"])) <= set(words(rp["name"])):
        ap["name"] = rp["name"]  # the research name adds a married name or nickname
    for f in families.values():
        for role in ("husb", "wife"):
            if f[role] == r:
                f[role] = a
        f["chil"] = list(dict.fromkeys(a if c == r else c for c in f["chil"]))
    for k in ("famc", "fams"):
        ap[k] = list(dict.fromkeys(ap[k] + rp[k]))


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

    # A research person or family that has since been entered on Ancestry is merged into the Ancestry copy at
    # the end, so its sourced facts and notes aren't lost and nothing shows twice.
    ALIASES.clear()

    def same(pid):
        while pid in ALIASES:
            pid = ALIASES[pid]
        return pid

    def given(name):
        words = [w for w in re.sub(r"[“”\"]", " ", name).split() if w.lower().strip(".") not in TITLES]
        return words[0].lower() if words else ""

    def alias(r, a):
        if r != a and r.startswith("@R") and not a.startswith("@R"):
            ALIASES[r] = a

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
        # an Ancestry record the fact already cites isn't listed twice
        m = re.search(r"ancestry\.com/search/collections/(\d+)/records/(\d+)", src.get("u") or "")
        if src not in e["src"] and not (m and any(s.get("a") == f"{m.group(1)}:{m.group(2)}" for s in e["src"])):
            e["src"] = e["src"] + [src]
        e["res"] = True

    for who, fact, src in ADDS:
        if have(who, "add"):
            fold(people[who]["events"], ev(fact["tag"], fact["date"], fact["place"], fact["detail"], src, fact["label"]))

    for who, tag, date, *place in DROPS:  # an optional place picks one of two facts with the same date
        if have(who, "drop"):
            people[who]["events"] = [e for e in people[who]["events"] if not (
                e["tag"] == tag and e["date"] == date and (not place or e["place"] == place[0]))]

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
        f = dict(f, husb=same(f["husb"]) if f["husb"] else None, wife=same(f["wife"]) if f["wife"] else None,
                 chil=[same(c) for c in f["chil"]])
        if not all(have(x, "new family") for x in [f["husb"], f["wife"], *f["chil"]] if x):
            continue
        clash = [c for c in f["chil"] if people[c]["famc"]]
        known = [x for x in (f["husb"], f["wife"]) if x and not x.startswith("@R")]
        twin = None if clash or not known else next((
            fid for fid in people[known[0]]["fams"]
            if all(not f[r] or not families[fid][r] or f[r] == families[fid][r]
                   or given(people[f[r]]["name"]) == given(people[families[fid][r]]["name"]) for r in ("husb", "wife"))
            and (any(given(people[c]["name"]) == given(people[k]["name"]) for c in f["chil"] for k in families[fid]["chil"])
                 if f["chil"] else all(f[r] and families[fid][r] for r in ("husb", "wife")))), None)
        if twin:  # the same couple (or single parent) already has a family on Ancestry
            ALIASES[f["id"]] = twin
            for role in ("husb", "wife"):
                if f[role] and families[twin][role]:
                    alias(f[role], families[twin][role])
            CHILDREN.insert(0, (twin, f["chil"]))
            if f["marr"]:
                MARRIAGES.insert(0, (twin, *f["marr"]))
            continue
        if clash:
            old = families[people[clash[0]]["famc"][0]]
            ok = all(not f[role] or not old[role] or f[role] == old[role]
                     or given(people[f[role]]["name"]) == given(people[old[role]]["name"]) for role in ("husb", "wife"))
            if not ok:
                warnings.append(f"{f['id']}: {', '.join(people[c]['name'] for c in clash)} already has other parents")
                continue
            fid = people[clash[0]]["famc"][0]
            ALIASES[f["id"]] = fid
            for role in ("husb", "wife"):
                if f[role] and old[role]:
                    alias(f[role], old[role])
                elif f[role]:  # the Ancestry family lacks this parent
                    old[role] = f[role]
                    join_family(fid, f[role], False)
            CHILDREN.insert(0, (fid, [c for c in f["chil"] if c not in clash]))
            if f["marr"]:
                MARRIAGES.insert(0, (fid, *f["marr"]))
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
        fid, pid = same(fid), same(pid)
        f = families.get(fid)
        if f and f[role] and f[role] != pid and given(people[f[role]]["name"]) == given(people[pid]["name"]):
            alias(pid, f[role])
            continue
        if not f or f[role]:
            warnings.append(f"{fid}: {'no such family' if not f else role + ' already set'}; skipped {people[pid]['name']}")
            continue
        f[role] = pid
        join_family(fid, pid, False)

    for fid, pids in CHILDREN:
        fid = same(fid)
        f = families.get(fid)
        if not f:
            warnings.append(f"{fid}: no such family")
            continue
        for pid in map(same, pids):
            name = people[pid]
            if pid in f["chil"]:
                continue
            twin = next((c for c in f["chil"] if given(people[c]["name"]) == given(name["name"])
                         and people[c]["surname"] == name["surname"]), None)
            if twin:
                if not (pid.startswith("@R") and not twin.startswith("@R")):
                    warnings.append(f"{fid}: {name['name']} looks like someone already in the family; skipped")
                alias(pid, twin)
                continue
            f["chil"].append(pid)
            join_family(fid, pid, True)
        sort_children(fid)

    for pid, fid in MOVES:
        pid, fid = same(pid), same(fid)
        if have(pid, "move") and fid in families:
            for old in people[pid]["famc"]:
                families[old]["chil"].remove(pid)
            people[pid]["famc"] = [fid]
            families[fid]["chil"].append(pid)
            sort_children(fid)

    for child, parent in UNLINKS:
        child, parent = same(child), same(parent)
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

    for pid in REMOVES:  # people taken out of the tree altogether
        pid = same(pid)
        if not have(pid, "remove"):
            continue
        for fid in people[pid]["famc"]:
            families[fid]["chil"].remove(pid)
        for fid in people[pid]["fams"]:
            f = families[fid]
            f["husb"], f["wife"] = (None if f["husb"] == pid else f["husb"]), (None if f["wife"] == pid else f["wife"])
        del people[pid]

    for fid, date, place, src in MARRIAGES:
        fid = same(fid)
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

    for r, a in ALIASES.items():
        if r in people and a in people:
            merge(people, families, r, a)

    for who, tag, date, place, src in GRAVES:
        who = same(who)
        if not have(who, "grave"):
            continue
        evs = people[who]["events"]
        olds = [e for e in evs if e["tag"] == tag]
        if not olds:
            evs.append(ev(tag, date, place, src=src))
            continue
        e = next((x for x in olds if date and year_of(x["date"]) == year_of(date)), olds[0])
        notes = []
        if date and year_of(e["date"]) not in (None, year_of(date)):
            notes.append(f"Find a Grave has {date}.")
        elif date and len(date) > len(re.sub(r"^(abt|about|bef|aft|est)\.? ", "", e["date"], flags=re.I)):
            e["date"] = date
        if place and not e["place"]:
            e["place"] = place
        elif place and not any(w in place.lower() for w in re.findall(r"[a-z]+", e["place"].split(",")[0].lower())):
            notes.append(f"Find a Grave has {place}.")
        e["detail"] = "; ".join(x for x in [e["detail"], *notes] if x)
        if src not in e["src"]:
            e["src"] = e["src"] + [src]
        e["res"] = True
        # a bare twin left by earlier research (same year, no place or detail) folds in, keeping its sources
        twins = [x for x in evs if x is not e and x["tag"] == tag and year_of(x["date"]) in (None, year_of(e["date"]))
                 and not x["place"] and not x["detail"]]
        e["src"] = e["src"] + [s for x in twins for s in x["src"] if s not in e["src"]]
        people[who]["events"] = [x for x in evs if not any(x is t for t in twins)]

    # research sources count alongside Ancestry's
    for p in people.values():
        p["nsrc"] += len({s["t"] for e in p["events"] for s in e["src"] if s.get("r")})
    return warnings
