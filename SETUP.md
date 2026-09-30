# Professor — Firebase Setup (5 minute)

App chalane ke liye koi server nahi chahiye — sirf yeh static files kisi bhi
hosting (GitHub Pages, Netlify, ya sirf file khol kar) par rakhein. Login ke
liye Firebase Authentication setup karna hai. Steps:

## 1. Firebase project banayein
1. https://console.firebase.google.com par jayein (Google account se login).
2. **Add project** (ya "Create a project") dabayein.
3. Project ka naam likhein, misal `professor-app`, **Continue**.
4. Google Analytics: chahein to off kar dein (zaroori nahi), **Create project**.
5. Project tayyar hone par **Continue** dabayein.

## 2. Authentication on karein
1. Left menu me **Build → Authentication** par jayein, **Get started** dabayein.
2. **Sign-in method** tab kholein:
   - **Email/Password** → **Enable** → **Save**.
   - **Google** → **Enable** → support email chunein → **Save**.

## 3. Web app register karke config copy karein
1. Project ke **Project settings** (left top par ⚙ gear icon) kholein.
2. **General** tab me neeche **Your apps** section me **Web** icon (`</>`) dabayein.
3. App nickname likhein (misal `professor-web`), **Register app**.
4. Jo `firebaseConfig` object nazar aaye, us ki values copy karein — yeh kuch is tarah hoga:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "professor-abc12.firebaseapp.com",
     projectId: "professor-abc12",
     storageBucket: "professor-abc12.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef..."
   };
   ```

## 4. Config file me paste karein
`firebase-config.js` kholein aur `PASTE_YOUR_...` wali jagahon par apni asal
values paste kar dein. Bas — login screen par notice ghaib ho jayegi.

## 5. (Optional) Domain allow karein
Agar app ko apni website par host kar rahe hain to:
**Authentication → Settings → Authorized domains** me apna domain add karein.
`localhost` pehle se allowed hota hai.

## 6. Gemini API key (har user apni)
Har user ko apni free key chahiye: https://aistudio.google.com/apikey
Key app ki **Key screen** me dali jati hai aur **sirf us ke browser ke
localStorage me** save hoti hai — hamare paas koi server nahi, key kahin
nahi jati.

---
**Note:** Jab tak `firebase-config.js` me placeholder values hain, app login
screen par "Firebase setup baqi hai" ka notice dikhayegi aur **Demo mode
(baghair login)** ka button degi taake app test ho sake.
