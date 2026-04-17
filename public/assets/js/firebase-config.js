import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwj7P-ADyXq0sB87Y_JYDySdgjAiNA2a8",
  authDomain: "puhunanph-835f7.firebaseapp.com",
  projectId: "puhunanph-835f7",
  storageBucket: "puhunanph-835f7.firebasestorage.app",
  messagingSenderId: "630926592560",
  appId: "1:630926592560:web:4ab31570f2814c19fafbf5",
  measurementId: "G-YC35SFV8WT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
