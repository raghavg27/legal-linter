import LogRocket from 'logrocket';

export const REPLAY_OPTIONS = { dom: { inputSanitizer: true } };

function onAccept() {
  localStorage.setItem('consent', 'yes');
  LogRocket.init('acme/web-app', REPLAY_OPTIONS);
}

export function CookieBanner() {
  return (
    <div role="dialog">
      <p>We record how you use this app to fix bugs, only if you agree.</p>
      <button onClick={onAccept}>Accept</button>
    </div>
  );
}
