// Per-year descriptions are only present in slashie.net’s (hash-named) JS bundle,
// not in projects.json, so this is a snapshot extracted from that bundle.
// The year IMAGES, however, live at stable URLs and are loaded live via the proxy.

export const YEAR_DESCRIPTIONS: Record<number, string> = {
  "1995": "Mother buys a 486. Kid Santi experiments with MS Paint creating ski jump \"games\" where you moved a \"sprite\" down a slope and made it jump.",
  "2000": "Still at high-school, somehow I learn how to do simple ROMHacks (text and tiles).",
  "2001": "Somehow (?) I learned QBasic and starting doing some games.",
  "2002": "First year at college. Started doing graphical QBasic and DirectQB managing to impress my schoolmates. Then jumped into Java, maybe too early.",
  "2003": "The quest to create the Ultimate roguelike is on. Fruitless. Empirical gamedev knowledge, using java, continues building up.",
  "2004": "A young slashie seek to apply what he's learning about software engineering to game design",
  "2005": "Increased participation on USENET leads to the creation of Roguebasin, and the first 7DRL Challenge starts a series of \"Completed\" games",
  "2006": "The era of Java Roguelikes starts",
  "2007": "Fresh out of university. Temple of the Roguelike rises, and I start the ill-fated development of Pixal, my PBBG that never saw the light of the day",
  "2008": "Development of Pixal continues eating my life, mostly.",
  "2009": "The first version of Expedition appears",
  "2010": "Pixal development ends. Slashie pushes ahead with the graphical version of Expedition.",
  "2011": "Slashware 1 is created as slashie dreams of indiedev greatness with Expedition 1, but takes a turn towards business dev instead.",
  "2012": "Slashware 1 drifts looking for an identity with many unfocused projects including a remake of ArcherFire made in Flash. Expedition 1 dies.",
  "2013": "Slashware 1 tries to survive but fails to make his way through the golden age of Desktop social media freemium.",
  "2014": "The renaissance of slashie as indiedev starts slow, with a first version of Ananias.",
  "2015": "Slashie continues building experience in procedural content generation, as the development of Ananias continues.",
  "2016": "As Ananias continues development, small experiments are made. First visit to San Francisco for Roguelike Celebration.",
  "2017": "A second age of JavaScript roguelikes starts.",
  "2018": "Slashware rises from the ashes, a new 3D incarnation of \"Expedition\" is the new hope.",
  "2019": "Expedition is further developed as it wins government funds",
  "2020": "As civilization collapses due to a deadly virus, Emerald Woods is born and Expedition transforms into NovaMundi.",
  "2021": "Development of NovaMundi is pushed forward.",
  "2022": "A procjam entry derails slashie into FormulaProc while NovaMundi development struggles. Project Hadria is born, as a concept in development ",
  "2023": "Emerald Woods has an unexpected revival while Slashie tried again to make NovaMundi's full release.",
  "2024": "Old projects get surprise releases while Slashie finally manages to do NovaMundi's full release. Work is done in Project Hadria design.",
  "2025": "Ananias transforms into Kramora's shadow, many jams are tackled under the shadows of extreme contract work load. Emerald Woods is stuck.",
  "2026": "What will this year bring? Emerald Woods was set to resume but stalled the first middle of the year, Senatus is brought to the eyes of the public while another secret project was developed."
};

/** Stable path on slashie.net; loaded through the /slashie proxy at runtime. */
export function yearImagePath(year: number): string | null {
  const map: Record<number, string> = {
  "1995": "img/years/1995.jpg",
  "2001": "img/years/2001.jpg",
  "2003": "img/years/2003.jpg",
  "2004": "img/years/2004.jpg",
  "2005": "img/years/2005.jpg",
  "2006": "img/years/2006.jpg",
  "2007": "img/years/2007.jpg",
  "2008": "img/years/2008.jpg",
  "2009": "img/years/2009.jpg",
  "2010": "img/years/2010.jpg",
  "2011": "img/years/2011.jpg",
  "2012": "img/years/2012.jpg",
  "2013": "img/years/2013.jpg",
  "2014": "img/years/2014.jpg",
  "2015": "img/years/2015.jpg",
  "2016": "img/years/2016.jpg",
  "2017": "img/years/2017.jpg",
  "2018": "img/years/2018.jpg",
  "2019": "img/years/2019.jpg",
  "2020": "img/years/2020.jpg",
  "2021": "img/years/2021.jpg",
  "2022": "img/years/2022.jpg",
  "2023": "img/years/2023.jpg",
  "2024": "img/years/2024.jpg",
  "2025": "img/years/2025.jpg",
  "2026": "img/years/2026.jpg"
};
  return map[year] ? "/slashie/" + map[year] : null;
}
