# TOC MONKEY — Deploy Guide
## Total time: ~15 minutes. No terminal required.

---

## STEP 1 — Get a domain (~5 min)
1. Go to **cloudflare.com/products/registrar** (cheapest, ~$10/yr)
2. Search for your domain name (e.g. `tocmonkey.com`)
3. Buy it — you'll need a Cloudflare account (free)

---

## STEP 2 — Deploy to Netlify (~5 min)

1. Go to **netlify.com** and sign up for free (use GitHub or email)

2. Once logged in, click **"Add new site"** → **"Deploy manually"**

3. **Drag the entire `tocmonkey-site` folder** onto the upload area

4. Netlify will give you a random URL like `jolly-einstein-abc123.netlify.app`
   — your site is already live at that URL

5. Go to **Site configuration → Environment variables** and add:
   ```
   Key:   ADMIN_PASSWORD
   Value: (pick a strong password — this protects your admin panel)
   ```
   Click Save, then **Trigger redeploy** (Deploys → Retry deploy)

---

## STEP 3 — Connect your domain (~5 min)

1. In Netlify: **Domain management → Add a domain** → type your domain
2. Netlify will show you two nameserver addresses like:
   ```
   dns1.p01.nsone.net
   dns2.p01.nsone.net
   ```
3. In Cloudflare: Go to your domain → **DNS → Nameservers** → switch to custom → paste Netlify's nameservers
4. Wait 5–30 minutes for DNS to propagate — then your domain is live

---

## STEP 4 — Access your admin panel

Go to: `https://yourdomain.com/admin`

Log in with the `ADMIN_PASSWORD` you set in Step 2.

**What you can do in the admin panel:**
- Add articles manually (title, author, publication, URL, blurb, tags)
- View all live RSS feed items from War on the Rocks, ISW, MWI, IWI, The Green Notebook
- One-click "ADD TO PICKS" on any RSS item to promote it to Chief's list
- Remove or reorder existing articles
- See which RSS feeds are live vs erroring

---

## RSS FEEDS CONFIGURED
| Source | Feed URL |
|--------|----------|
| War on the Rocks | warontherocks.com/feed/ |
| ISW | understandingwar.org/rss.xml |
| Modern War Institute | mwi.westpoint.edu/feed/ |
| Irregular Warfare Initiative | irregularwarfare.org/feed/ |
| The Green Notebook | thegreennotebook.com/feed/ |

RSS items are cached for 30 minutes automatically.

---

## ADDING MORE RSS SOURCES LATER

Open `netlify/functions/rss.js` and add to the `FEEDS` array:
```js
{
  name:   "Source Name",
  handle: "SHORTNAME",
  url:    "https://example.com/feed/",
  color:  "amber",
},
```
Then re-drag the folder to Netlify to redeploy.

---

## COSTS
| Item | Cost |
|------|------|
| Domain (Cloudflare) | ~$10/yr |
| Netlify hosting | Free |
| Netlify Blobs storage | Free (included) |
| Netlify Functions | Free (125k req/mo) |
| **Total** | **~$10/yr** |

---

## FILE STRUCTURE
```
tocmonkey-site/
├── index.html              ← Main dashboard
├── admin.html              ← Admin panel (/admin)
├── netlify.toml            ← Netlify config
├── package.json            ← Dependencies
└── netlify/
    └── functions/
        ├── articles.js     ← Article CRUD API
        └── rss.js          ← RSS feed aggregator
```
