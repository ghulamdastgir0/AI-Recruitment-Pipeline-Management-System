/* eslint-disable */
// One-off SMTP/Brevo test script — sends every EmailType template to a target address.
require('dotenv').config();
const { buildEmail } = require('../dist/src/shared/email/email-templates');

const TO = process.argv[2] || 'ghulamdastgir12905@gmail.com';
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

const apiKey = process.env.SMTP_API;
const senderEmail = process.env.BREVO_SENDER_EMAIL;
const senderName = process.env.BREVO_SENDER_NAME;

if (!apiKey || !senderEmail) {
  console.error('Missing SMTP_API or BREVO_SENDER_EMAIL in .env');
  process.exit(1);
}

const future = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const scenarios = [
  {
    type: 'APPLICATION_RECEIVED',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
      applicationReference: 'APP-2026-000123',
      statusLink: 'https://example.com/status/APP-2026-000123',
    },
  },
  {
    type: 'SCREENING_REJECTION',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
    },
  },
  {
    type: 'INTERVIEW_ACKNOWLEDGEMENT',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
      interviewDeadline: future(3),
      interviewLink: 'https://example.com/interview/abc123',
    },
  },
  {
    type: 'INTERVIEW_REMINDER',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
      interviewDeadline: future(2),
      interviewLink: 'https://example.com/interview/abc123',
    },
  },
  {
    type: 'SELECTION',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
    },
  },
  {
    type: 'NEXT_ROUND',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
      nextRoundTime: future(5),
      nextRoundDeadline: future(4),
    },
  },
  {
    type: 'REJECTION',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
    },
  },
  {
    type: 'BULK_REJECTION',
    variables: {
      candidateName: 'Ghulam Dastgir',
      jobTitle: 'Senior Backend Engineer',
    },
  },
];

async function sendOne(scenario) {
  const { subject, html } = buildEmail(scenario.type, scenario.variables);
  const taggedSubject = `[TEST: ${scenario.type}] ${subject}`;

  const response = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName || undefined },
      to: [{ email: TO }],
      subject: taggedSubject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`FAILED ${scenario.type}: (${response.status}) ${body}`);
    return false;
  }
  console.log(`OK      ${scenario.type}`);
  return true;
}

(async () => {
  console.log(`Sending ${scenarios.length} test emails to ${TO} via Brevo...\n`);
  let ok = 0;
  for (const scenario of scenarios) {
    const success = await sendOne(scenario);
    if (success) ok++;
    // Small delay to be polite to the API.
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`\n${ok}/${scenarios.length} sent successfully.`);
  process.exit(ok === scenarios.length ? 0 : 1);
})();
