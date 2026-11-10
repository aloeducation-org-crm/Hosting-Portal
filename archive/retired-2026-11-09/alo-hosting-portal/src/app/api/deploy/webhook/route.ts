import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { executeDeployment } from '@/lib/deploy/orchestrator';

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();
    const sigHeader = request.headers.get('x-hub-signature-256');
    const signature = sigHeader ? sigHeader : '';
    const eventHeader = request.headers.get('x-github-event');
    const eventName = eventHeader ? eventHeader : '';
    const deliveryHeader = request.headers.get('x-github-delivery');
    const deliveryId = deliveryHeader ? deliveryHeader : '';
    const secretA = process.env.GITHUB_WEBHOOK_SECRET;
    const secretB = process.env.CRON_SECRET;
    let webhookSecret = '';
    if (secretA) { webhookSecret = secretA; }
    else if (secretB) { webhookSecret = secretB; }
    if (webhookSecret.length > 0 && signature.length > 0) {
      const hmac = crypto.createHmac('sha256', webhookSecret);
      hmac.update(bodyText);
      const digest = 'sha256=' + hmac.digest('hex');
      const aBuf = Buffer.from(signature);
      const bBuf = Buffer.from(digest);
      let sigOk = false;
      if (aBuf.length === bBuf.length) {
        sigOk = crypto.timingSafeEqual(aBuf, bBuf);
      }
      if (sigOk === false) {
        return NextResponse.json({ success: false, error: 'Invalid HMAC signature' }, { status: 401 });
      }
    }
    if (eventName === 'push' || eventName === 'workflow_dispatch') {
      let payload: any = {};
      try { payload = JSON.parse(bodyText); } catch { payload = {}; }
      let repoUrl = '';
      if (payload.repository && payload.repository.clone_url) { repoUrl = payload.repository.clone_url; }
      else if (payload.repository && payload.repository.html_url) { repoUrl = payload.repository.html_url; }
      let branch = 'main';
      if (payload.ref && typeof payload.ref === 'string') {
        const prefix = 'refs/heads/';
        if (payload.ref.indexOf(prefix) === 0) {
          branch = payload.ref.substring(prefix.length);
        } else {
          branch = payload.ref;
        }
      }
      let commitHash = 'manual';
      if (payload.after) { commitHash = payload.after; }
      else if (payload.head_commit && payload.head_commit.id) { commitHash = payload.head_commit.id; }
      let commitMessage = 'GitHub Push Event';
      if (payload.head_commit && payload.head_commit.message) { commitMessage = payload.head_commit.message; }
      let commitAuthor = 'GitHub User';
      if (payload.head_commit && payload.head_commit.author && payload.head_commit.author.name) {
        commitAuthor = payload.head_commit.author.name;
      } else if (payload.pusher && payload.pusher.name) {
        commitAuthor = payload.pusher.name;
      }
      if (repoUrl.length === 0) {
        return NextResponse.json({ success: false, message: 'No repository URL in payload' }, { status: 400 });
      }
      let repoName = '';
      if (payload.repository && payload.repository.name) { repoName = payload.repository.name; }
      let repoFull = repoName;
      if (payload.repository && payload.repository.full_name) { repoFull = payload.repository.full_name; }
      if (repoName.length === 0) {
        return NextResponse.json({ success: false, message: 'Missing repo name' }, { status: 400 });
      }
      const website = await prisma.website.findFirst({
        where: {
          OR: [
            { domain: repoName },
            { documentRoot: { contains: repoName } }
          ]
        }
      });
      if (website === null || website === undefined) {
        return NextResponse.json({
          success: true,
          message: 'Webhook received. No website linked yet.',
          repository: repoFull,
          commit: commitHash
        });
      }
      const deployResult = await executeDeployment({
        websiteId: website.id,
        repositoryUrl: repoUrl,
        branch: branch,
        commitHash: commitHash,
        commitMessage: commitMessage,
        commitAuthor: commitAuthor
      });
      return NextResponse.json({
        success: true,
        message: 'Deployment triggered via GitHub webhook',
        deliveryId: deliveryId,
        deployResult: deployResult
      });
    }
    if (eventName === 'ping') {
      return NextResponse.json({ success: true, message: 'pong' });
    }
    return NextResponse.json({ success: true, message: 'Event acknowledged: ' + eventName });
  } catch (err: any) {
    let msg = 'webhook error';
    if (err && err.message) { msg = String(err.message); }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ success: true, message: 'deploy webhook alive' });
}
