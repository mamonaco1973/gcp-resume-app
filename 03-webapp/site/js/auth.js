/* ========================================================================== */
/* auth.js                                                                     */
/* Firebase Auth helpers: initialise the Firebase app, manage sign-in/out,   */
/* and vend fresh ID tokens for API requests.                                 */
/* ========================================================================== */

import { initializeApp }                        from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail as fbSendPasswordResetEmail,
  signOut as fbSignOut,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";

import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------------
// Firebase Initialisation
// -----------------------------------------------------------------------------

const app  = initializeApp({
  apiKey:    CONFIG.apiKey,
  authDomain: CONFIG.authDomain,
  projectId: CONFIG.projectId,
});

export const auth = getAuth(app);

// -----------------------------------------------------------------------------
// Token access — Firebase auto-refreshes tokens before they expire
// -----------------------------------------------------------------------------

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return "";
  return user.getIdToken();
}

export function isLoggedIn() {
  return !!auth.currentUser;
}

// -----------------------------------------------------------------------------
// Auth operations
// -----------------------------------------------------------------------------

export async function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Send verification email immediately — unverified users are blocked at sign-in
  await sendEmailVerification(cred.user);
  return cred;
}

export async function signOut() {
  return fbSignOut(auth);
}

export async function sendPasswordReset(email) {
  return fbSendPasswordResetEmail(auth, email);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

// -----------------------------------------------------------------------------
// Auth state subscription
// -----------------------------------------------------------------------------

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/* -------------------------------------------------------------------------- */
/* Function: waitForUser                                                        */
/* Purpose: Resolve with the current user once Firebase has restored the      */
/*          session from storage. Avoids acting on a null currentUser that    */
/*          exists only because initialisation hasn't completed yet.          */
/* -------------------------------------------------------------------------- */
export function waitForUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}
