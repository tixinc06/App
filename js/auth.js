// Authentication + session state.
// Owns the auth screen wiring, the current-user cache, and session init.
import { sb } from './supabase.js';

let _user = null;
export const getUser = () => _user;
export const getUid = () => _user?.id || null;

// Subscribe to auth changes and resolve the initial session.
// onChange(session) is called on the first load and on every sign in/out.
export async function initSession(onChange) {
  sb.auth.onAuthStateChange((_event, session) => {
    _user = session?.user || null;
    onChange(session);
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
        const { data, error } = await sb.auth.signUp(creds);
        if (error) throw error;
        // If email confirmation is on, there's no session yet.
        if (!data.session) {
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
