# NGO Donation Website (Netlify + Supabase)

Is folder mein poori website hai: login/register, UPI QR donation, departments, membership, receipt, donors list aur admin panel. Koi npm package nahi chahiye.

- `public/index.html` : poori website ka design aur code, ek hi file mein
- `netlify/functions/api.mjs` : website ka backend (login, donation, admin)
- `supabase-setup.sql` : database ki tables (ek baar chalani hai)
- `netlify.toml` : Netlify ki settings

## Step 1: Free database banayein (Supabase) - 5 minute
1. https://supabase.com par free account banayein, **New project** dabayein. Region mein **Mumbai (ap-south-1)** chunein aur ek Database Password likh kar rakhein.
2. Project ban jaye to left menu mein **SQL Editor > New query** kholein. `supabase-setup.sql` file ka poora text paste karke **Run** dabayein. "Success" aana chahiye.
3. **Project Settings > API** (ya "API Keys") kholein aur 2 cheezein copy karein:
   - **Project URL** (jaise `https://abcdxyz.supabase.co`)
   - **service_role** secret key (lambi key; ise kisi ko na dein, aur "anon" key use na karein)

## Step 2: Netlify par upload karein
1. https://app.netlify.com mein **Add new site > Deploy manually** kholein.
2. Is zip ko unzip karke uska poora folder drag karein (zip bhi drag kar sakte hain). Site ban jayegi aur ek link milega.
3. **Site configuration > Environment variables > Add a variable** se ye 4 variables daalein:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Step 1 ka Project URL |
| `SUPABASE_SERVICE_KEY` | Step 1 ki service_role key |
| `ADMIN_EMAIL` | aapka admin email |
| `ADMIN_PASSWORD` | aapka admin password (kam se kam 8 akshar) |

4. Variables daalne ke baad site ko **dobara deploy** karein (Deploys page par wahi folder phir se drag karein). Bina dobara deploy kiye variables kaam nahi karte.

## Step 3: Admin se site set karein
1. Site kholkar **Log in** par ADMIN_EMAIL aur ADMIN_PASSWORD se login karein. Upar menu mein **Admin** dikhega.
2. **Settings and QR** mein PhonePe QR image upload karein, UPI ID, logo, NGO ka naam, address, phone aur registration / 80G details daalein. **Save settings** dabayein.
3. **Causes** mein departments badlein ya naye jodein, **Membership plans** mein price badlein.
4. Pehle login ke baad **My Account** mein apna password badal lein.

## Payment kaise verify hota hai
Donor QR se pay karke UTR (reference number) daalta hai, aur donation "Pending" rehta hai. Aap bank ya PhonePe statement mein UTR match karke Admin > Payments mein **Approve** dabate hain. Tabhi wo donors list mein aata hai aur receipt par "Verified" likha aata hai. "Approve automatically" on karne par ye check nahi hota, to fake UTR ka risk rehta hai.

## Dhyan rakhein
- Agar site par "The server is not set up yet" ya "Database tables are missing" jaisa message dikhe, to Step 1 ka SQL ya Step 2 ke variables check karein, phir dobara deploy karein.
- Supabase ka free project kuch din koi use na ho to pause ho sakta hai. Supabase dashboard se ek click mein wapas chalu hota hai.
- Data Supabase mein rehta hai, to Netlify par dobara deploy karne se data nahi jaata. Admin > Payments se CSV download karke backup rakhein.
- UPI QR sirf India ke UPI apps se chalta hai. Videsh ke donors ke liye alag payment gateway chahiye.
- 80G / FCRA ke rules ke liye apne CA se confirm karein.
