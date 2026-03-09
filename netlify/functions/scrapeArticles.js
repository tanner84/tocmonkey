// ─────────────────────────────────────────────────────────────
// Scrape and classify articles from authoritative sources
// ─────────────────────────────────────────────────────────────
const Parser = require('rss-parser');
const { getStore } = require('@netlify/blobs');
const { classifyByCOCOM } = require('../../src/utils/cocomClassifier');

const COCOMS = ['EUCOM', 'CENTCOM', 'INDOPACOM', 'AFRICOM', 'SOUTHCOM', 'NORTHCOM'];
const SOURCES = [
  // MAJOR THINK TANKS
  { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/' },
  { name: 'CSIS', url: 'https://www.csis.org/rss-feeds' },
  { name: 'RAND', url: 'https://www.rand.org/topics/military-affairs.xml' },
  { name: 'ISW', url: 'https://www.understandingwar.org/rss.xml' },
  { name: 'Carnegie Endowment', url: 'https://carnegieendowment.org/rss/region/all' },
  { name: 'Atlantic Council', url: 'https://www.atlanticcouncil.org/feed/' },
  { name: 'Brookings', url: 'https://www.brookings.edu/feed/' },
  { name: 'CFR', url: 'https://www.cfr.org/rss.xml' },
  { name: 'RUSI', url: 'https://rusi.org/rss.xml' },
  { name: 'CNAS', url: 'https://www.cnas.org/press/rss' },
  { name: 'Hudson Institute', url: 'https://www.hudson.org/feed' },
  { name: 'AEI', url: 'https://www.aei.org/feed/' },
  { name: 'Stimson Center', url: 'https://www.stimson.org/feed/' },
  { name: 'Wilson Center', url: 'https://www.wilsoncenter.org/rss.xml' },
  // MILITARY JOURNALS & PUBLICATIONS
  { name: 'Small Wars Journal', url: 'https://smallwarsjournal.com/rss.xml' },
  { name: 'Military Review', url: 'https://www.armyupress.army.mil/Portals/7/military-review/rss.xml' },
  { name: 'Joint Force Quarterly', url: 'https://ndupress.ndu.edu/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1050&max=10' },
  { name: 'Parameters', url: 'https://press.armywarcollege.edu/parameters/recent.rss' },
  { name: 'Naval War College Review', url: 'https://digital-commons.usnwc.edu/nwc-review/recent.rss' },
  { name: 'Air & Space Power Journal', url: 'https://www.airuniversity.af.edu/Portals/10/ASPJ/rss.xml' },
  { name: 'Marine Corps Gazette', url: 'https://mca-marines.org/wp-content/uploads/magazine_rss.xml' },
  { name: 'Proceedings (USNI)', url: 'https://www.usni.org/magazines/proceedings/rss' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/' },
  { name: 'The Warfighter', url: 'https://mwi.usma.edu/feed/' },
  // REGIONAL SPECIALISTS
  { name: 'ECFR', url: 'https://ecfr.eu/feed/' },
  { name: 'Middle East Institute', url: 'https://www.mei.edu/rss.xml' },
  { name: 'Carnegie Middle East Center', url: 'https://carnegie-mec.org/rss/region/all' },
  { name: 'Asia Maritime Transparency Initiative', url: 'https://amti.csis.org/feed/' },
  { name: 'Lowy Institute', url: 'https://www.lowyinstitute.org/the-interpreter/feed' },
  { name: 'Carnegie India', url: 'https://carnegieindia.org/rss/region/all' },
  { name: 'Africa Center for Strategic Studies', url: 'https://africacenter.org/feed/' },
  { name: 'ISS Africa', url: 'https://issafrica.org/rss' },
  { name: 'Wilson Center Latin America', url: 'https://www.wilsoncenter.org/program/latin-american-program/rss.xml' },
  { name: 'InSight Crime', url: 'https://insightcrime.org/feed/' },
  // DEFENSE JOURNALISM
  { name: 'USNI News', url: 'https://news.usni.org/feed' },
  { name: 'The War Zone', url: 'https://www.thedrive.com/the-war-zone/rss' },
  { name: 'Defense One', url: 'https://www.defenseone.com/rss/' },
  { name: 'Breaking Defense', url: 'https://breakingdefense.com/feed/' },
  { name: 'Military Times', url: 'https://www.militarytimes.com/arc/outboundfeeds/rss/' },
  { name: 'Stars and Stripes', url: 'https://www.stripes.com/rss.xml' },
  { name: 'Task & Purpose', url: 'https://taskandpurpose.com/feed/' },
  { name: 'Janes Defence', url: 'https://www.janes.com/defence-news/rss' },
  { name: 'C4ISRNET', url: 'https://www.c4isrnet.com/arc/outboundfeeds/rss/' },
  { name: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/' },
  // OFFICIAL SOURCES (where available)
  { name: 'DOD News', url: 'https://www.defense.gov/Newsroom/News/Transcripts/Feed/' },
  { name: 'State Department', url: 'https://www.state.gov/rss-feed/' },
  { name: 'GAO', url: 'https://www.gao.gov/rss/news.xml' },
];

exports.handler = async function() {
  // Netlify Scheduled Function: run daily at 06:00 UTC
  exports.schedule = "0 6 * * *";
  const parser = new Parser();
  const store = getStore('tocmonkey');
  let allArticles = [];
  for (const src of SOURCES) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const item of feed.items) {
        const article = {
          title: item.title,
          url: item.link,
          source: src.name,
          description: item.contentSnippet || item.summary || '',
        };
        // Classify by COCOM
        const cocoms = classifyByCOCOM(article.title + ' ' + article.description);
        for (const cocom of cocoms) {
          if (!COCOMS.includes(cocom)) continue;
          // Deduplication: use article URL as unique key
          const blobKey = `articles-${cocom}`;
          const raw = await store.get(blobKey).catch(()=>null);
          let articles = raw ? JSON.parse(raw) : [];
          if (!articles.some(a => a.url === article.url)) {
            const newArticle = { ...article, id: Date.now().toString(), cocom };
            articles.unshift(newArticle);
            await store.set(blobKey, JSON.stringify(articles.slice(0,100)));
          }
        }
        allArticles.push(article);
      }
    } catch (e) {
      // Ignore errors for individual feeds
    }
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, total: allArticles.length }),
  };
};
