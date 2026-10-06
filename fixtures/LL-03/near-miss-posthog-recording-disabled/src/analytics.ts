import posthog from 'posthog-js';

const options = {
  api_host: 'https://eu.i.posthog.com',
  disable_session_recording: true,
};

posthog.init(import.meta.env.VITE_POSTHOG_KEY, options);
