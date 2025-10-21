// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');

const app = express();
app.use(cors());
app.use(express.json());

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  FILE_PATH = 'submissions/submissions.json',
  BRANCH = 'main',
  PORT = process.env.PORT || 3000,
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error('Missing required env variables: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// helper to get file content (if exists) and sha
async function getFile() {
  try {
    const res = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: FILE_PATH,
      ref: BRANCH,
    });
    // content is base64 encoded
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    return { content, sha: res.data.sha };
  } catch (err) {
    // if not found, return null to create new file
    if (err.status === 404) return null;
    throw err;
  }
}

// endpoint to accept submissions
app.post('/submit', async (req, res) => {
  try {
    const { name, email, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'name, email and message are required' });
    }

    // basic sanitization - trim
    const entry = {
      name: String(name).trim(),
      email: String(email).trim(),
      message: String(message).trim(),
      timestamp: new Date().toISOString(),
    };

    // get current file
    const existing = await getFile();
    let submissions = [];
    let sha = null;

    if (existing && existing.content) {
      try {
        submissions = JSON.parse(existing.content);
        if (!Array.isArray(submissions)) submissions = [];
      } catch (parseErr) {
        // file content isn't valid JSON - back it up and start fresh
        submissions = [];
      }
      sha = existing.sha;
    } else {
      // file doesn't exist yet - we'll create it
      submissions = [];
    }

    submissions.push(entry);

    const newContent = JSON.stringify(submissions, null, 2);
    const encoded = Buffer.from(newContent, 'utf8').toString('base64');

    // create or update file
    const commitMessage = `Add submission from ${entry.email} at ${entry.timestamp}`;

    if (sha) {
      // update existing file
      await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: FILE_PATH,
        message: commitMessage,
        content: encoded,
        sha,
        branch: BRANCH,
      });
    } else {
      // create new file
      await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: FILE_PATH,
        message: commitMessage,
        content: encoded,
        branch: BRANCH,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error in /submit:', err);
    res.status(500).json({ success: false, error: err.message || err.toString() });
  }
});

app.get('/', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));