import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { detectFramework } from './detector';

const execAsync = promisify(exec);

export interface DeployOptions {
  websiteId: string;
  repositoryUrl: string;
  branch: string;
  commitHash: string;
  commitMessage?: string;
  commitAuthor?: string;
  actorId?: string;
}

export async function executeDeployment(options: DeployOptions) {
  const websiteId = options.websiteId;
  const repositoryUrl = options.repositoryUrl;
  const branch = options.branch;
  const commitHash = options.commitHash;
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: { environments: true }
  });
  if (website === null || website === undefined) {
    throw new Error('Website not found: ' + websiteId);
  }
  const actorVal = options.actorId ? options.actorId : null;
  const deployment = await prisma.deployment.create({
    data: {
      websiteId: websiteId,
      commitHash: commitHash,
      source: repositoryUrl,
      status: 'RUNNING',
      startedAt: new Date(),
      actorId: actorVal
    }
  });
  const writeLog = async function(level: string, message: string): Promise<void> {
    const prefix = '[Deploy:' + deployment.id + '] [' + level + '] ';
    console.log(prefix + message);
    await prisma.deploymentLog.create({
      data: {
        deploymentId: deployment.id,
        level: level,
        message: message,
        timestamp: new Date()
      }
    });
  };
  await writeLog('INFO', 'Starting deployment for commit ' + commitHash + ' on branch ' + branch);
  const baseStorage = process.env.STORAGE_ROOT || '/home/alamin/storage';
  const appDeployDir = path.join(baseStorage, 'deployments', websiteId);
  const shortHash = commitHash.substring(0, 7);
  const releaseId = 'rel_' + String(Date.now()) + '_' + shortHash;
  const releaseDir = path.join(appDeployDir, 'releases', releaseId);
  const currentSymlink = path.join(appDeployDir, 'current');
  try {
    fs.mkdirSync(path.join(appDeployDir, 'releases'), { recursive: true });
    await writeLog('INFO', 'Cloning repository ' + repositoryUrl + ' branch ' + branch);
    const cloneCmd = 'git clone --depth 1 --branch ' + branch + ' ' + repositoryUrl + ' ' + releaseDir;
    await execAsync(cloneCmd);
    try {
      const revCmd = 'git -C ' + releaseDir + ' rev-parse HEAD';
      const revOut = await execAsync(revCmd);
      const sha = String(revOut.stdout).trim();
      await writeLog('INFO', 'Checked out SHA: ' + sha);
    } catch {
      await writeLog('WARN', 'Could not verify git commit hash locally');
    }
    const detected = detectFramework(releaseDir);
    await writeLog('INFO', 'Detected Framework: ' + detected.framework + ' lang ' + detected.language);
    const envLines: string[] = [];
    for (const e of website.environments) {
      envLines.push(e.key + '=' + e.value);
    }
    const nl = String.fromCharCode(10);
    const envContent = envLines.join(nl);
    fs.writeFileSync(path.join(releaseDir, '.env'), envContent);
    await writeLog('INFO', 'Install: ' + detected.installCmd);
    const installRes = await execAsync(detected.installCmd, { cwd: releaseDir });
    const installOut = String(installRes.stdout || '');
    if (installOut.length > 0) {
      await writeLog('INFO', installOut.substring(0, 500));
    }
    const skipBuild = detected.buildCmd.indexOf('NO_BUILD') >= 0 || detected.buildCmd.indexOf('No build') >= 0;
    if (skipBuild === false) {
      await writeLog('INFO', 'Build: ' + detected.buildCmd);
      const buildRes = await execAsync(detected.buildCmd, { cwd: releaseDir });
      const buildOut = String(buildRes.stdout || '');
      if (buildOut.length > 0) {
        await writeLog('INFO', buildOut.substring(0, 500));
      }
    }
    const previousRelease = await prisma.release.findFirst({
      where: { websiteId: websiteId },
      orderBy: { version: 'desc' }
    });
    let nextVersion = 1;
    if (previousRelease) {
      nextVersion = previousRelease.version + 1;
    }
    const releaseRecord = await prisma.release.create({
      data: {
        websiteId: websiteId,
        version: nextVersion,
        path: releaseDir,
        commitHash: commitHash
      }
    });
    await writeLog('INFO', 'Updating live release symlink');
    try {
      const st = fs.lstatSync(currentSymlink);
      if (st) {
        fs.unlinkSync(currentSymlink);
      }
    } catch {
      // no existing symlink
    }
    fs.symlinkSync(releaseDir, currentSymlink, 'dir');
    await prisma.website.update({
      where: { id: websiteId },
      data: {
        currentReleasePath: releaseDir,
        status: 'ACTIVE'
      }
    });
    let appPort = detected.defaultPort;
    if (website.applicationPort) {
      appPort = website.applicationPort;
    }
    const healthUrl = 'http://127.0.0.1:' + String(appPort) + detected.healthPath;
    await writeLog('INFO', 'Health check ' + healthUrl);
    let isHealthy = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(function() { ctrl.abort(); }, 3000);
        const res = await fetch(healthUrl, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
          isHealthy = true;
          break;
        }
      } catch {
        await new Promise<void>(function(resolve) { setTimeout(function() { resolve(); }, 1000); });
      }
    }
    if (isHealthy === false) {
      await writeLog('WARN', 'Health probe did not pass yet: ' + healthUrl);
    } else {
      await writeLog('INFO', 'Health check PASSED at ' + healthUrl);
    }
    let prevId: string | null = null;
    if (previousRelease) {
      prevId = previousRelease.id;
    }
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        releaseId: releaseRecord.id,
        previousReleaseId: prevId
      }
    });
    await writeLog('INFO', 'Deployment ' + deployment.id + ' SUCCESS release v' + String(nextVersion));
    return {
      success: true,
      deploymentId: deployment.id,
      releaseVersion: nextVersion,
      commitHash: commitHash
    };
  } catch (err: any) {
    let errorMsg = 'Unknown deployment failure';
    if (err && err.message) {
      errorMsg = String(err.message);
    }
    await writeLog('ERROR', 'Deployment failed: ' + errorMsg);
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        buildOutput: errorMsg.substring(0, 2000)
      }
    });
    try {
      const lastGood = await prisma.release.findFirst({
        where: { websiteId: websiteId },
        orderBy: { version: 'desc' }
      });
      if (lastGood && fs.existsSync(lastGood.path)) {
        await writeLog('INFO', 'Rollback to v' + String(lastGood.version));
        try { fs.unlinkSync(currentSymlink); } catch { }
        fs.symlinkSync(lastGood.path, currentSymlink, 'dir');
        await writeLog('INFO', 'Rolled back to ' + lastGood.path);
      }
    } catch {
      await writeLog('WARN', 'Rollback skipped');
    }
    return {
      success: false,
      deploymentId: deployment.id,
      error: errorMsg
    };
  }
}
