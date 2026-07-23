// Authentication + session state.
// Owns the auth screen wiring, the current-user cache, and session init.
import { sb } from './supabase.js';
import { USERNAME_RE } from './profile.js';

let _user = null;
export const getUser = () => _user;
export const getUid = () => _user?.id || null;

// Subscribe to auth changes and resolve the initial session.
// onChange(session) is called on the first load and on every sign in/out.
export async function initSession(onChange) {
  sb.auth.onAuthStateChange((_event, session) => {
    _user = session?.user || null;
    // Deferred outside this callback: Supabase holds an internal auth lock
    // for the duration of onAuthStateChange, so a .from()/.rpc() query
    // issued directly from inside it (as onChange's ban check does) can
    // hang or reject — a documented Supabase footgun that was the root
    // cause of a banned user bypassing the suspended-screen gate on a
    // TOKEN_REFRESHED/session event.
    setTimeout(() => onChange(session), 0);
  });
  const { data: { session } } = await sb.auth.getSession();
  _user = session?.user || null;
  return session;
}

export function logout() {
  return sb.auth.signOut();
}

// Wire the email/password form. Handles both "log in" and "sign up" modes.
export function wireAuthScreen() {
  const form = document.getElementById('auth-form');
  const email = document.getElementById('auth-email');
  const usernameLabel = document.getElementById('auth-username-label');
  const username = document.getElementById('auth-username');
  const pass = document.getElementById('auth-password');
  const err = document.getElementById('auth-error');
  const submit = document.getElementById('auth-submit');
  const toggleBtn = document.getElementById('auth-toggle-btn');
  const toggleText = document.getElementById('auth-toggle-text');
  let mode = 'login';

  function setMode(m) {
    mode = m;
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    toggleText.textContent = m === 'login' ? 'New here?' : 'Already have an account?';
    toggleBtn.textContent = m === 'login' ? 'Create an account' : 'Log in';
    pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    usernameLabel.hidden = m !== 'signup';
    username.required = m === 'signup';
    err.hidden = true;
  }
  function showMsg(text, ok = false) {
    err.textContent = text;
    err.style.color = ok ? 'var(--green)' : '';
    err.hidden = false;
  }

  toggleBtn.onclick = () => setMode(mode === 'login' ? 'signup' : 'login');

  form.onsubmit = async e => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Please wait…';
    const creds = { email: email.value.trim(), password: pass.value };
    try {
      if (mode === 'signup') {
        const desiredUsername = username.value.trim().toLowerCase();
        if (!USERNAME_RE.test(desiredUsername)) {
          throw new Error('Username must be 3-20 characters: lowercase letters, numbers, underscore.');
        }
        const { data, error } = await sb.auth.signUp(creds);
        if (error) throw error;
        // Always stash the desired username rather than claiming it here —
        // signUp() also fires app.js's onAuthStateChange-triggered username
        // gate independently, and having BOTH this code and that gate try to
        // insert the profile row would be a race (whichever loses sees a
        // confusing "taken" error for a username that's already theirs). The
        // gate is the single place that ever creates the row; it consumes
        // this value automatically, with no visible prompt, whenever a
        // session is already available.
        localStorage.setItem('pendingUsername', desiredUsername);
        if (!data.session) {
          // Email confirmation is on — no session yet.
          setMode('login');
          showMsg('Account created! Check your email to confirm, then log in.', true);
        }
      } else {
        const { error } = await sb.auth.signInWithPassword(creds);
        if (error) throw error;
      }
    } catch (ex) {
      showMsg(friendly(ex.message));
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  };

  setMode('login');
}

function friendly(msg = '') {
  if (/invalid login/i.test(msg)) return 'Wrong email or password.';
  if (/already registered/i.test(msg)) return 'That email already has an account — try logging in.';
  if (/at least 6/i.test(msg)) return 'Password must be at least 6 characters.';
  return msg || 'Something went wrong.';
}
