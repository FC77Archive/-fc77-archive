# FC77 – Update your details (lookup page)

A tiny self-service page for FC77 players: enter your email → if you're already in
HubSpot, your record is shown pre-filled → edit → save. New people are created.
Saving goes through the existing HubSpot form ("Update Your Contact Information"),
so the form's follow-up email and any workflows fire exactly as before.

- `index.html` – the page (static)
- `api/lookup.js` – Vercel serverless function that looks up a contact by email using a
  HubSpot private-app token kept in an environment variable (never exposed to the browser)

## One-time setup (≈10 minutes)

### 1. Put this folder in the GitHub repo
Copy the contents of this folder into the repo (root, or a subfolder such as `/update-details`
— if you use a subfolder, set that as the **Root Directory** in Vercel in step 3). Commit and push.

### 2. Create a HubSpot private app + token
HubSpot → Settings (gear) → Integrations → **Private Apps** → *Create a private app*
- Name: `FC77 update-details lookup`
- Scopes tab → CRM → tick **crm.objects.contacts.read** and **crm.schemas.contacts.read**
  (read-only is enough; the page saves through the public Forms API, not the token)
- Create app → **Show token** → copy it. Treat it like a password.

### 3. Deploy on Vercel
- vercel.com → *Add New… → Project* → import the GitHub repo (authorise GitHub if asked)
- Framework preset: **Other**. Root Directory: this folder if it isn't the repo root.
- **Environment Variables** – add:
  - `HUBSPOT_TOKEN` = the private-app token from step 2
  - (optional) `HUBSPOT_PORTAL_ID` = `40098597` and `HUBSPOT_FORM_GUID` =
    `ee9352bb-5915-4a2a-9a6b-aac74a2f9491` — these are already the defaults in the code
- Deploy. You'll get a URL like `https://fc77-update.vercel.app`. Add a custom domain
  (e.g. `update.fc77.org`) in Vercel → Project → Domains if you want.

### 4. Test
Open the URL, enter an email that exists in HubSpot → step 2 should show the record
pre-filled. Change something, save → check the contact in HubSpot and that the
"FC77: please confirm your details" follow-up email arrives.

## How it works
- `GET /api/lookup` returns the internal property names and the live option lists for
  "Do you currently play for an FC77 team?" and "FC77 Team" (looked up by label, so it keeps
  working even if internal names differ). Cached 10 min.
- `POST /api/lookup {email}` searches contacts by email and returns the fields shown on the page.
  Basic per-IP rate limit (20/min).
- The browser submits to HubSpot's Forms Submission API for portal 40098597 / the existing
  form GUID, including the `hubspotutk` cookie (the HubSpot tracking script is on the page),
  so the submission is attributed like a normal form fill.
- "FC77 Team" checkboxes are hidden unless the answer is Yes (done in the page, no HubSpot
  Pro logic needed).

## Notes / limits
- Anyone who types an email sees that contact's on-file details (open lookup, by design).
  If that ever becomes a concern, switch to a "send me my edit link" flow.
- Rate limiting is per warm serverless instance; for stronger abuse protection add Vercel's
  WAF/rate-limit rules or a captcha.
- To change which fields are shown, edit `STANDARD_PROPS` in `api/lookup.js` and the matching
  inputs in `index.html` (input `id`/`name` must equal the HubSpot property name).
