import posthog from 'posthog-js';

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
  api_host: 'https://us.i.posthog.com',
  opt_out_capturing_by_default: true,
  session_recording: { maskAllInputs: true },
});
