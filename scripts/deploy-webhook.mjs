#!/usr/bin/env node

const requiredEnvVars = ['DEPLOY_WEBHOOK_URL'];

for (const name of requiredEnvVars) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const payload = {
  event: 'deploy',
  repository: process.env.DEPLOY_REPOSITORY ?? 'unknown',
  ref: process.env.DEPLOY_REF ?? 'unknown',
  sha: process.env.DEPLOY_SHA ?? 'unknown',
  runUrl: process.env.DEPLOY_RUN_URL ?? 'unknown',
  rollbackHint:
    process.env.DEPLOY_ROLLBACK_HINT ?? 'Redeploy the previous approved revision or artifact.',
};

const headers = {
  'Content-Type': 'application/json',
  'User-Agent': 'luminariweb-deploy/1.0',
};

if (process.env.DEPLOY_WEBHOOK_TOKEN) {
  headers.Authorization = `Bearer ${process.env.DEPLOY_WEBHOOK_TOKEN}`;
}

const response = await fetch(process.env.DEPLOY_WEBHOOK_URL, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const responseText = await response.text().catch(() => '');
  console.error(
    `Deployment webhook failed with ${response.status} ${response.statusText}${
      responseText ? `: ${responseText}` : ''
    }`,
  );
  process.exit(1);
}

console.log(`Deployment webhook accepted with ${response.status}.`);
