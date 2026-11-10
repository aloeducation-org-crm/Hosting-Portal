import { PrismaClient } from '@prisma/client'
import { hashPassword } from './src/lib/auth'

const db = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create demo user
  const passwordHash = await hashPassword('demo1234')
  const user = await db.user.upsert({
    where: { email: 'demo@alolabs.net' },
    update: {},
    create: {
      email: 'demo@alolabs.net',
      name: 'Alex Johnson',
      passwordHash,
      role: 'admin',
      plan: 'business',
      company: 'ALO Labs',
      phone: '+1-555-0100',
    },
  })
  console.log(`Created user: ${user.email}`)

  // Create domains
  const domains = await Promise.all([
    db.domain.create({
      data: {
        userId: user.id, name: 'alolabs.net', tld: '.net', status: 'active',
        expiryDate: new Date('2027-03-15'), autoRenew: true,
        nameservers: JSON.stringify(['ns1.alolabs.net', 'ns2.alolabs.net']),
        dnsRecords: JSON.stringify([
          { type: 'A', name: '@', value: '185.243.55.42', ttl: 3600 },
          { type: 'A', name: 'www', value: '185.243.55.42', ttl: 3600 },
          { type: 'MX', name: '@', value: 'mail.alolabs.net', priority: 10, ttl: 3600 },
          { type: 'TXT', name: '@', value: 'v=spf1 include:_spf.alolabs.net ~all', ttl: 3600 },
        ]),
      },
    }),
    db.domain.create({
      data: {
        userId: user.id, name: 'cloudplatform.io', tld: '.io', status: 'active',
        expiryDate: new Date('2026-12-01'), autoRenew: true,
        nameservers: JSON.stringify(['ns1.alolabs.net', 'ns2.alolabs.net']),
        dnsRecords: JSON.stringify([
          { type: 'A', name: '@', value: '185.243.55.43', ttl: 3600 },
        ]),
      },
    }),
    db.domain.create({
      data: {
        userId: user.id, name: 'startup.dev', tld: '.dev', status: 'active',
        expiryDate: new Date('2026-08-20'), autoRenew: false,
        nameservers: JSON.stringify(['ns1.alolabs.net', 'ns2.alolabs.net']),
        dnsRecords: JSON.stringify([]),
      },
    }),
  ])
  console.log(`Created ${domains.length} domains`)

  // Create websites
  const websites = await Promise.all([
    db.website.create({
      data: {
        userId: user.id, name: 'ALO Labs Main', domainId: domains[0].id,
        type: 'custom', status: 'active',
        publishedUrl: 'https://alolabs.net',
        htmlContent: '<!DOCTYPE html><html><body><h1>ALO Labs</h1></body></html>',
        lastPublishedAt: new Date(Date.now() - 86400000),
      },
    }),
    db.website.create({
      data: {
        userId: user.id, name: 'Cloud Platform Portal', domainId: domains[1].id,
        type: 'custom', status: 'active',
        publishedUrl: 'https://cloudplatform.io',
        lastPublishedAt: new Date(Date.now() - 3600000),
      },
    }),
    db.website.create({
      data: {
        userId: user.id, name: 'Dev Blog', domainId: domains[2].id,
        type: 'wordpress', status: 'building',
        publishedUrl: null,
      },
    }),
  ])
  console.log(`Created ${websites.length} websites`)

  // Create databases
  const dbs = await Promise.all([
    db.hostedDatabase.create({
      data: {
        userId: user.id, name: 'alolabs_main', type: 'postgresql', version: '16',
        status: 'active', host: 'postgresql.alolabs.net', port: 5432,
        username: 'db_a1b2c3d4', password: 'super_secret_password_here',
        sizeMb: 1024, usedMb: 347,
      },
    }),
    db.hostedDatabase.create({
      data: {
        userId: user.id, name: 'analytics_db', type: 'mongodb', version: '7.0',
        status: 'active', host: 'mongodb.alolabs.net', port: 27017,
        username: 'db_e5f6g7h8', password: 'mongo_secret_password',
        sizeMb: 2048, usedMb: 1203,
      },
    }),
    db.hostedDatabase.create({
      data: {
        userId: user.id, name: 'cache_layer', type: 'redis', version: '7.2',
        status: 'active', host: 'redis.alolabs.net', port: 6379,
        username: 'default', password: 'redis_secret_key',
        sizeMb: 256, usedMb: 89,
      },
    }),
  ])
  console.log(`Created ${dbs.length} databases`)

  // Create applications
  const apps = await Promise.all([
    db.application.create({
      data: {
        userId: user.id, name: 'API Gateway', description: 'Main API gateway service',
        type: 'node', status: 'running', gitUrl: 'https://github.com/alolabs/api-gateway.git',
        branch: 'main', envVars: JSON.stringify({ NODE_ENV: 'production', PORT: '3000', DB_HOST: 'postgresql.alolabs.net' }),
        port: 3000, cpu: '1', memory: '1024', disk: '5120',
        url: 'api-gateway.alolabs.app', uptime: 864000, lastDeployed: new Date(Date.now() - 86400000),
      },
    }),
    db.application.create({
      data: {
        userId: user.id, name: 'Frontend App', description: 'React frontend application',
        type: 'docker', status: 'running', imageUrl: 'node:20-alpine',
        envVars: JSON.stringify({ NEXT_PUBLIC_API_URL: 'https://api-gateway.alolabs.app' }),
        port: 3000, cpu: '0.5', memory: '512', disk: '1024',
        url: 'frontend.alolabs.app', uptime: 864000, lastDeployed: new Date(Date.now() - 172800000),
      },
    }),
    db.application.create({
      data: {
        userId: user.id, name: 'ML Pipeline', description: 'Machine learning data processing pipeline',
        type: 'python', status: 'stopped', gitUrl: 'https://github.com/alolabs/ml-pipeline.git',
        branch: 'main', envVars: JSON.stringify({ PYTHON_VERSION: '3.12' }),
        port: 8000, cpu: '2', memory: '4096', disk: '10240',
        url: 'ml-pipeline.alolabs.app', uptime: 0, lastDeployed: new Date(Date.now() - 604800000),
      },
    }),
  ])
  console.log(`Created ${apps.length} applications`)

  // Create deployments
  const deployments = [
    { appId: apps[0].id, v: '12', status: 'live', commit: 'a1b2c3d', msg: 'Fix rate limiting middleware', branch: 'main', dur: 47 },
    { appId: apps[0].id, v: '11', status: 'live', commit: 'e4f5g6h', msg: 'Add WebSocket support', branch: 'feat/websocket', dur: 62 },
    { appId: apps[1].id, v: '8', status: 'live', commit: 'i7j8k9l', msg: 'Update UI components', branch: 'main', dur: 38 },
    { appId: apps[2].id, v: '3', status: 'failed', commit: 'm0n1o2p', msg: 'Update dependencies', branch: 'main', dur: 120 },
  ]
  await Promise.all(
    deployments.map((d) =>
      db.deployment.create({
        data: {
          applicationId: d.appId, version: d.v, status: d.status,
          commit: d.commit, commitMessage: d.msg, branch: d.branch,
          triggeredBy: d.branch === 'main' ? 'git_push' : 'manual',
          duration: d.dur, completedAt: new Date(Date.now() - d.dur * 1000),
          logs: `Building application...\nInstalling dependencies...\nCompiling assets...\nRunning tests...\n${d.status === 'failed' ? 'ERROR: Test suite failed (3 failures)\n' : 'All tests passed.\n'}Deploying to production...\n${d.status === 'live' ? 'Deployment successful.' : 'Deployment failed.'}`,
        },
      })
    )
  )
  console.log('Created deployments')

  // Create servers
  const servers = await Promise.all([
    db.server.create({
      data: {
        userId: user.id, name: 'Production Server', hostname: 'prod-alo-01', ip: '185.243.55.42',
        os: 'ubuntu-24.04', plan: 'vps-4', cpuCores: 4, memoryMb: 8192, diskGb: 100,
        bandwidthTb: 4, status: 'running', uptime: 2592000,
      },
    }),
    db.server.create({
      data: {
        userId: user.id, name: 'Staging Server', hostname: 'staging-alo-01', ip: '185.243.55.43',
        os: 'ubuntu-24.04', plan: 'vps-2', cpuCores: 2, memoryMb: 4096, diskGb: 50,
        bandwidthTb: 2, status: 'running', uptime: 1296000,
      },
    }),
  ])
  console.log(`Created ${servers.length} servers`)

  // Create SSL certificates
  const certs = await Promise.all([
    db.sslCertificate.create({
      data: {
        userId: user.id, domain: 'alolabs.net', type: 'letsencrypt', status: 'active',
        issuer: "Let's Encrypt Authority X3", issuedAt: new Date('2025-03-15'),
        expiresAt: new Date('2026-03-15'), autoRenew: true,
      },
    }),
    db.sslCertificate.create({
      data: {
        userId: user.id, domain: '*.alolabs.app', type: 'wildcard', status: 'active',
        issuer: "Let's Encrypt Authority X3", issuedAt: new Date('2025-06-01'),
        expiresAt: new Date('2026-06-01'), autoRenew: true,
      },
    }),
    db.sslCertificate.create({
      data: {
        userId: user.id, domain: 'cloudplatform.io', type: 'letsencrypt', status: 'active',
        issuer: "Let's Encrypt Authority X3", issuedAt: new Date('2025-01-20'),
        expiresAt: new Date('2026-01-20'), autoRenew: false,
      },
    }),
  ])
  console.log(`Created ${certs.length} SSL certificates`)

  // Create backups
  await Promise.all([
    db.backup.create({
      data: {
        userId: user.id, name: 'Daily Full Backup', type: 'full', target: 'website',
        targetId: websites[0].id, sizeMb: 256, status: 'completed', schedule: '0 2 * * *',
        retentionDays: 30, storagePath: '/backups/alolabs-net-full-2025-07-19.tar.gz',
      },
    }),
    db.backup.create({
      data: {
        userId: user.id, name: 'Database Backup', type: 'database', target: 'database',
        targetId: dbs[0].id, sizeMb: 89, status: 'completed', schedule: '0 3 * * *',
        retentionDays: 14, storagePath: '/backups/alolabs_main-db-2025-07-19.sql.gz',
      },
    }),
    db.backup.create({
      data: {
        userId: user.id, name: 'Incremental Backup', type: 'incremental', target: 'application',
        targetId: apps[0].id, sizeMb: 45, status: 'completed',
        retentionDays: 7, storagePath: '/backups/api-gateway-inc-2025-07-19.tar.gz',
      },
    }),
  ])
  console.log('Created backups')

  // Create CRM contacts
  const crmContacts = await Promise.all([
    db.crmContact.create({
      data: {
        userId: user.id, firstName: 'Sarah', lastName: 'Chen', email: 'sarah@techcorp.com',
        phone: '+1-555-0201', company: 'TechCorp', title: 'CTO', status: 'customer', source: 'referral',
      },
    }),
    db.crmContact.create({
      data: {
        userId: user.id, firstName: 'Marcus', lastName: 'Williams', email: 'marcus@startup.io',
        phone: '+1-555-0202', company: 'StartupIO', title: 'Founder', status: 'prospect', source: 'form',
      },
    }),
    db.crmContact.create({
      data: {
        userId: user.id, firstName: 'Emily', lastName: 'Rodriguez', email: 'emily@design.studio',
        phone: '+1-555-0203', company: 'Design Studio', title: 'Lead Developer', status: 'lead', source: 'manual',
      },
    }),
    db.crmContact.create({
      data: {
        userId: user.id, firstName: 'James', lastName: 'Park', email: 'james@enterprise.co',
        phone: '+1-555-0204', company: 'Enterprise Co', title: 'VP Engineering', status: 'prospect', source: 'import',
      },
    }),
  ])
  console.log(`Created ${crmContacts.length} CRM contacts`)

  // Create CRM pipeline and deals
  const pipeline = await db.crmPipeline.create({
    data: {
      userId: user.id, name: 'Sales Pipeline',
      stages: JSON.stringify(['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']),
    },
  })
  await Promise.all([
    db.crmDeal.create({
      data: {
        userId: user.id, contactId: crmContacts[0].id, pipelineId: pipeline.id,
        title: 'Enterprise Hosting Plan', value: 2400, stage: 'Closed Won',
        probability: 100, expectedCloseDate: new Date('2025-06-01'),
      },
    }),
    db.crmDeal.create({
      data: {
        userId: user.id, contactId: crmContacts[1].id, pipelineId: pipeline.id,
        title: 'Startup Annual Plan', value: 600, stage: 'Proposal',
        probability: 60, expectedCloseDate: new Date('2025-08-15'),
      },
    }),
    db.crmDeal.create({
      data: {
        userId: user.id, contactId: crmContacts[3].id, pipelineId: pipeline.id,
        title: 'Custom Infrastructure', value: 12000, stage: 'Negotiation',
        probability: 75, expectedCloseDate: new Date('2025-09-01'),
      },
    }),
  ])
  console.log('Created CRM pipeline and deals')

  // Create email accounts
  await Promise.all([
    db.emailAccount.create({
      data: { userId: user.id, email: 'alex@alolabs.net', provider: 'alolabs', quota: 10000, usedQuota: 3200, status: 'active' },
    }),
    db.emailAccount.create({
      data: { userId: user.id, email: 'support@alolabs.net', provider: 'alolabs', quota: 5000, usedQuota: 1800, status: 'active' },
    }),
  ])
  console.log('Created email accounts')

  // Create email campaigns
  await Promise.all([
    db.emailCampaign.create({
      data: {
        userId: user.id, subject: 'Welcome to ALO Labs Cloud Platform', status: 'sent',
        body: '<h1>Welcome!</h1><p>Get started with your new cloud hosting platform.</p>',
        recipientList: JSON.stringify(['sarah@techcorp.com', 'marcus@startup.io', 'emily@design.studio']),
        recipientCount: 3, openCount: 2, clickCount: 1,
        sentAt: new Date(Date.now() - 604800000),
      },
    }),
    db.emailCampaign.create({
      data: {
        userId: user.id, subject: 'New AI Agent Tools Available', status: 'draft',
        body: '<h1>AI Agents</h1><p>Check out our new AI agent marketplace.</p>',
        recipientList: JSON.stringify([]), recipientCount: 0,
      },
    }),
  ])
  console.log('Created email campaigns')

  // Create notifications
  await Promise.all([
    db.notification.create({ data: { userId: user.id, title: 'Deployment Successful', message: 'API Gateway v12 deployed to production', type: 'success', read: false } }),
    db.notification.create({ data: { userId: user.id, title: 'SSL Certificate Renewal', message: 'alolabs.net SSL certificate auto-renewed successfully', type: 'info', read: false } }),
    db.notification.create({ data: { userId: user.id, title: 'Backup Completed', message: 'Daily full backup completed (256 MB)', type: 'success', read: true } }),
    db.notification.create({ data: { userId: user.id, title: 'High CPU Usage', message: 'Production server CPU usage exceeded 85%', type: 'warning', read: false } }),
    db.notification.create({ data: { userId: user.id, title: 'Domain Expiring Soon', message: 'startup.dev expires in 30 days', type: 'warning', read: true } }),
  ])
  console.log('Created notifications')

  // Create API keys
  await Promise.all([
    db.apiKey.create({
      data: { userId: user.id, name: 'Production API Key', key: 'alo_k8x2m9p4q7r1s5t3v6w0y', permissions: 'admin', lastUsedAt: new Date() },
    }),
    db.apiKey.create({
      data: { userId: user.id, name: 'CI/CD Key', key: 'alo_z4b6n8c0e2g4i6k8m0o2q', permissions: 'write' },
    }),
  ])
  console.log('Created API keys')

  // Create subscription and orders
  await db.subscription.create({
    data: {
      userId: user.id, plan: 'business', status: 'active', amount: 7.99,
      startDate: new Date('2025-01-01'), endDate: new Date('2026-01-01'),
    },
  })
  await Promise.all([
    db.order.create({
      data: { userId: user.id, items: JSON.stringify([{ type: 'subscription', name: 'Business Plan', price: 7.99, qty: 1 }]), total: 7.99, status: 'completed', paymentMethod: 'card', createdAt: new Date('2025-01-01') },
    }),
    db.order.create({
      data: { userId: user.id, items: JSON.stringify([{ type: 'domain', name: 'alolabs.net', price: 9.99, qty: 1 }, { type: 'domain', name: 'cloudplatform.io', price: 29.99, qty: 1 }]), total: 39.98, status: 'completed', paymentMethod: 'card', createdAt: new Date('2025-03-15') },
    }),
    db.order.create({
      data: { userId: user.id, items: JSON.stringify([{ type: 'server', name: 'VPS-4 Production', price: 29.99, qty: 1 }]), total: 29.99, status: 'completed', paymentMethod: 'card', createdAt: new Date('2025-02-10') },
    }),
  ])
  console.log('Created subscriptions and orders')

  // Create invoices
  await Promise.all([
    db.invoice.create({ data: { userId: user.id, orderId: null, amount: 7.99, status: 'paid', dueDate: new Date('2025-02-01'), paidAt: new Date('2025-01-28') } }),
    db.invoice.create({ data: { userId: user.id, orderId: null, amount: 7.99, status: 'paid', dueDate: new Date('2025-03-01'), paidAt: new Date('2025-02-27') } }),
    db.invoice.create({ data: { userId: user.id, orderId: null, amount: 7.99, status: 'pending', dueDate: new Date('2025-08-01') } }),
  ])
  console.log('Created invoices')

  // Create containers
  const containers = await Promise.all([
    db.container.create({
      data: {
        userId: user.id, serverId: servers[0].id, name: 'nginx-proxy', image: 'nginx:1.25-alpine',
        status: 'running', port: 80, cpuUsage: 2.4, memoryUsage: 64.5, diskUsage: 45.2,
        networkIn: 12.8, networkOut: 45.3, uptime: 2592000,
      },
    }),
    db.container.create({
      data: {
        userId: user.id, serverId: servers[0].id, name: 'api-gateway', image: 'kong:3.6',
        status: 'running', port: 8000, cpuUsage: 8.7, memoryUsage: 256.3, diskUsage: 128.7,
        networkIn: 34.5, networkOut: 67.2, uptime: 2592000,
      },
    }),
    db.container.create({
      data: {
        userId: user.id, serverId: servers[0].id, name: 'redis-cache', image: 'redis:7.2-alpine',
        status: 'running', port: 6379, cpuUsage: 1.2, memoryUsage: 512.8, diskUsage: 32.1,
        networkIn: 5.6, networkOut: 4.8, uptime: 2592000,
      },
    }),
    db.container.create({
      data: {
        userId: user.id, serverId: servers[1].id, name: 'postgres-db', image: 'postgres:16-alpine',
        status: 'running', port: 5432, cpuUsage: 5.3, memoryUsage: 384.2, diskUsage: 2048.5,
        networkIn: 2.1, networkOut: 1.8, uptime: 1296000,
      },
    }),
  ])
  console.log(`Created ${containers.length} containers`)

  // Create SSH keys
  await Promise.all([
    db.sshKey.create({
      data: {
        userId: user.id, name: 'My Laptop',
        publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKj8G7m2Vb4LqzRfTnWvE0sKxMp3HnJcDpYqRtWvE0sX alex@macbook-pro.local',
        fingerprint: 'SHA256:nThbg6kXUpJWGl7E1IGOCspRomTxdCARLviKw6E5SY8',
        type: 'ed25519',
      },
    }),
    db.sshKey.create({
      data: {
        userId: user.id, name: 'CI/CD Deploy Key',
        publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE4qZkT8mRp1XjNcY3WdF0pKsHjLqMnBvCxRyTzUwVnK ci@github-actions',
        fingerprint: 'SHA256:p2Qh4G8kL9mN1oP3rS6tU8vW0xY2zA4bC6dE8fG0hJ2',
        type: 'ed25519',
      },
    }),
  ])
  console.log('Created SSH keys')

  // Create firewall rules
  await Promise.all([
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Allow HTTP', protocol: 'tcp', port: '80', source: '0.0.0.0/0', action: 'allow', priority: 10, enabled: true } }),
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Allow HTTPS', protocol: 'tcp', port: '443', source: '0.0.0.0/0', action: 'allow', priority: 20, enabled: true } }),
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Allow SSH', protocol: 'tcp', port: '22', source: '10.0.0.0/8', action: 'allow', priority: 30, enabled: true } }),
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Deny High Ports', protocol: 'tcp', port: '1024-65535', source: '0.0.0.0/0', action: 'deny', priority: 50, enabled: true } }),
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Allow App Port', protocol: 'tcp', port: '8080', source: '10.0.0.0/8', action: 'allow', priority: 25, enabled: true } }),
    db.firewallRule.create({ data: { userId: user.id, serverId: servers[0].id, name: 'Allow Ping', protocol: 'icmp', port: '*', source: '0.0.0.0/0', action: 'allow', priority: 40, enabled: true } }),
  ])
  console.log('Created firewall rules')

  // Create audit logs
  const auditActions = [
    { action: 'user.login', resource: 'auth', details: JSON.stringify({ method: 'password', browser: 'Chrome 126' }) },
    { action: 'server.create', resource: 'server', resourceId: servers[0].id, resourceName: 'Production Server', details: JSON.stringify({ plan: 'vps-4' }) },
    { action: 'deployment.trigger', resource: 'deployment', details: JSON.stringify({ app: 'API Gateway', version: '12' }) },
    { action: 'container.start', resource: 'container', resourceId: containers[0].id, resourceName: 'nginx-proxy', details: '{}' },
    { action: 'firewall.rule.create', resource: 'firewall', details: JSON.stringify({ rule: 'Allow HTTPS' }) },
    { action: 'sshkey.add', resource: 'sshkey', details: JSON.stringify({ name: 'CI/CD Deploy Key' }) },
    { action: 'database.create', resource: 'database', details: JSON.stringify({ name: 'analytics_db', type: 'mongodb' }) },
    { action: 'domain.register', resource: 'domain', details: JSON.stringify({ domain: 'cloudplatform.io' }) },
    { action: 'ssl.issue', resource: 'ssl', details: JSON.stringify({ domain: '*.alolabs.app', type: 'wildcard' }) },
    { action: 'backup.create', resource: 'backup', details: JSON.stringify({ type: 'full', size: '256MB' }) },
    { action: 'webhook.create', resource: 'webhook', details: JSON.stringify({ name: 'GitHub Push', url: 'https://api.github.com/...' }) },
    { action: 'deployment.fail', resource: 'deployment', details: JSON.stringify({ app: 'ML Pipeline', version: '3', error: 'Test suite failed' }) },
    { action: 'server.restart', resource: 'server', resourceId: servers[1].id, resourceName: 'Staging Server', details: '{}' },
    { action: 'user.settings.update', resource: 'settings', details: JSON.stringify({ field: 'two_factor_enabled', value: true }) },
    { action: 'api_key.create', resource: 'api_key', details: JSON.stringify({ name: 'Production API Key', permissions: 'admin' }) },
    { action: 'container.restart', resource: 'container', resourceId: containers[1].id, resourceName: 'api-gateway', details: '{}' },
    { action: 'cronjob.create', resource: 'cronjob', details: JSON.stringify({ name: 'Daily Backup', schedule: '0 2 * * *' }) },
    { action: 'secret.create', resource: 'secret', details: JSON.stringify({ name: 'DB_PASSWORD' }) },
    { action: 'dns.record.update', resource: 'dns', details: JSON.stringify({ type: 'A', name: '@', value: '185.243.55.42' }) },
    { action: 'user.logout', resource: 'auth', details: JSON.stringify({ browser: 'Chrome 126' }) },
  ]
  await Promise.all(
    auditActions.map((a, i) =>
      db.auditLog.create({
        data: {
          userId: user.id,
          ...a,
          ipAddress: '185.243.55.42',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0',
          createdAt: new Date(Date.now() - (auditActions.length - i) * 3600000),
        },
      })
    )
  )
  console.log('Created audit logs')

  // Create alerts
  await Promise.all([
    db.alert.create({
      data: {
        userId: user.id, name: 'High CPU Usage', type: 'metric', condition: '> 85',
        metricName: 'cpu', threshold: 85, channel: 'email',
        channelConfig: JSON.stringify({ email: 'alex@alolabs.net' }),
        enabled: true, lastTriggered: new Date(Date.now() - 1800000),
      },
    }),
    db.alert.create({
      data: {
        userId: user.id, name: 'High Memory Usage', type: 'metric', condition: '> 80',
        metricName: 'memory', threshold: 80, channel: 'slack',
        channelConfig: JSON.stringify({ webhook: 'https://hooks.slack.com/...' }),
        enabled: true, lastTriggered: new Date(Date.now() - 7200000),
      },
    }),
    db.alert.create({
      data: {
        userId: user.id, name: 'Deployment Failed', type: 'event', condition: '== failed',
        metricName: 'deployment_status', threshold: 1, channel: 'email',
        channelConfig: JSON.stringify({ email: 'alex@alolabs.net', slack: true }),
        enabled: true, lastTriggered: new Date(Date.now() - 86400000),
      },
    }),
    db.alert.create({
      data: {
        userId: user.id, name: 'SSL Expiring Soon', type: 'metric', condition: '< 30 days',
        metricName: 'ssl_expiry', threshold: 30, channel: 'email',
        channelConfig: JSON.stringify({ email: 'alex@alolabs.net' }),
        enabled: true, lastTriggered: new Date(Date.now() - 604800000),
      },
    }),
  ])
  console.log('Created alerts')

  // Create webhooks
  await Promise.all([
    db.webhook.create({
      data: {
        userId: user.id, name: 'GitHub Push', url: 'https://api.github.com/repos/alolabs/platform/dispatches',
        secret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder',
        events: JSON.stringify(['push', 'pull_request']),
        enabled: true, lastTrigger: new Date(Date.now() - 3600000), successCount: 142, failCount: 3,
      },
    }),
    db.webhook.create({
      data: {
        userId: user.id, name: 'Slack Notifications', url: 'https://hooks.slack.com/services/T0X/B0X/abc123',
        secret: process.env.STRIPE_WEBHOOK_SECRET_2 || 'whsec_placeholder',
        events: JSON.stringify(['deployment.*', 'alert.*', 'server.*']),
        enabled: true, lastTrigger: new Date(Date.now() - 1800000), successCount: 89, failCount: 1,
      },
    }),
    db.webhook.create({
      data: {
        userId: user.id, name: 'Discord Alerts', url: 'https://discord.com/api/webhooks/1234567890/xyz',
        events: JSON.stringify(['alert.triggered', 'deployment.failed']),
        enabled: true, lastTrigger: new Date(Date.now() - 86400000), successCount: 23, failCount: 0,
      },
    }),
  ])
  console.log('Created webhooks')

  // Create organization
  const org = await db.organization.create({
    data: {
      userId: user.id, name: 'ALO Labs Inc.', slug: 'alo-labs-inc', plan: 'business',
    },
  })
  console.log('Created organization')

  // Create team members
  const adminUser = await db.user.upsert({
    where: { email: 'john@alolabs.net' },
    update: {},
    create: { email: 'john@alolabs.net', name: 'John Smith', role: 'admin', plan: 'free' },
  })
  const memberUser = await db.user.upsert({
    where: { email: 'sarah@alolabs.net' },
    update: {},
    create: { email: 'sarah@alolabs.net', name: 'Sarah Lee', role: 'user', plan: 'free' },
  })
  await Promise.all([
    db.teamMember.create({
      data: { userId: user.id, organizationId: org.id, role: 'owner', status: 'active', joinedAt: new Date('2025-01-01') },
    }),
    db.teamMember.create({
      data: { userId: adminUser.id, organizationId: org.id, role: 'admin', invitedEmail: 'john@alolabs.net', status: 'active', joinedAt: new Date('2025-02-15') },
    }),
    db.teamMember.create({
      data: { userId: memberUser.id, organizationId: org.id, role: 'member', invitedEmail: 'sarah@alolabs.net', status: 'active', joinedAt: new Date('2025-04-01') },
    }),
  ])
  console.log('Created team members')

  // Create storage buckets
  await Promise.all([
    db.storageBucket.create({
      data: { userId: user.id, name: 'app-assets', region: 'us-east-1', provider: 'alolabs', access: 'public', sizeMb: 2048, objectCount: 1256 },
    }),
    db.storageBucket.create({
      data: { userId: user.id, name: 'backups', region: 'us-east-1', provider: 'alolabs', access: 'private', sizeMb: 15360, objectCount: 47 },
    }),
    db.storageBucket.create({
      data: { userId: user.id, name: 'logs', region: 'eu-west-1', provider: 'alolabs', access: 'private', sizeMb: 8192, objectCount: 8934 },
    }),
  ])
  console.log('Created storage buckets')

  // Create DNS records
  await Promise.all([
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'A', name: '@', value: '185.243.55.42', ttl: 3600, proxied: true } }),
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'AAAA', name: '@', value: '2a06:98c1:3120::3', ttl: 3600, proxied: true } }),
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'CNAME', name: 'www', value: 'alolabs.net', ttl: 3600, proxied: true } }),
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'MX', name: '@', value: 'mail.alolabs.net', ttl: 3600, priority: 10 } }),
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'TXT', name: '@', value: 'v=spf1 include:_spf.alolabs.net ~all', ttl: 3600 } }),
    db.dnsRecord.create({ data: { userId: user.id, domainId: domains[0].id, type: 'SRV', name: '_sip._tcp', value: 'sip.alolabs.net', ttl: 3600, priority: 10 } }),
  ])
  console.log('Created DNS records')

  // Create log entries (30 entries across different sources and levels)
  const logSources = [
    { source: 'server', sourceId: servers[0].id, level: 'info', messages: ['Server health check passed', 'SSH connection established from 10.0.0.1', 'System update available: kernel 6.8.4', 'Disk usage at 42% - within normal range', 'NTP time synchronized with pool.ntp.org', 'Firewall rules reloaded successfully'] },
    { source: 'container', sourceId: containers[0].id, level: 'info', messages: ['Container nginx-proxy started on port 80', 'Handling 1.2k requests/min', 'SSL handshake completed in 12ms'] },
    { source: 'container', sourceId: containers[1].id, level: 'warn', messages: ['API response time exceeded 500ms threshold', 'Rate limiter activated for IP 203.0.113.42'] },
    { source: 'application', level: 'info', messages: ['User session created for alex@alolabs.net', 'Cache hit ratio: 94.2%', 'Background job queue: 3 pending, 0 failed', 'New deployment triggered via git push'] },
    { source: 'application', level: 'warn', messages: ['Memory usage approaching 80% limit', 'Slow query detected: SELECT * FROM orders (1.2s)'] },
    { source: 'application', level: 'error', messages: ['Failed to connect to Redis: ECONNREFUSED', 'Unhandled promise rejection in worker thread'] },
    { source: 'deployment', level: 'info', messages: ['Build started for API Gateway v12', 'Running test suite... 47/47 passed', 'Deployment to production completed in 47s'] },
    { source: 'deployment', level: 'error', messages: ['Build failed for ML Pipeline v3: dependency conflict', 'Test suite failed: 3 assertions broken'] },
    { source: 'system', level: 'info', messages: ['Cron job "Daily Backup" executed successfully', 'SSL certificate for alolabs.net is valid for 234 days', 'Auto-scaling review: no action needed'] },
    { source: 'system', level: 'warn', messages: ['Certificate for cloudplatform.io expires in 45 days', 'Disk I/O latency increased by 15%'] },
    { source: 'system', level: 'error', messages: ['Failed to send alert notification: timeout after 30s'] },
  ]
  const logEntries: { source: string; sourceId?: string; level: string; message: string }[] = []
  for (const group of logSources) {
    for (const msg of group.messages) {
      logEntries.push({ source: group.source, sourceId: group.sourceId, level: group.level, message: msg })
    }
  }
  await Promise.all(
    logEntries.slice(0, 30).map((entry, i) =>
      db.logEntry.create({
        data: {
          userId: user.id,
          ...entry,
          metadata: JSON.stringify({ timestamp: new Date(Date.now() - (30 - i) * 300000).toISOString() }),
          createdAt: new Date(Date.now() - (30 - i) * 300000),
        },
      })
    )
  )
  console.log(`Created ${Math.min(logEntries.length, 30)} log entries`)

  // Create prompt templates
  await Promise.all([
    db.promptTemplate.create({
      data: {
        userId: user.id, name: 'Code Review', category: 'development',
        content: 'You are an expert code reviewer. Review the following {{language}} code for bugs, performance issues, security vulnerabilities, and best practices.\n\nCode:\n```\n{{code}}\n```\n\nProvide specific, actionable feedback.',
        variables: JSON.stringify(['language', 'code']), isPublic: true, usageCount: 47,
      },
    }),
    db.promptTemplate.create({
      data: {
        userId: user.id, name: 'Bug Fix', category: 'development',
        content: 'You are a senior developer. Given the following bug report and code, identify the root cause and provide a fix.\n\nBug Report:\n{{bug_report}}\n\nCode:\n```\n{{code}}\n```\n\nExplain the issue and provide corrected code.',
        variables: JSON.stringify(['bug_report', 'code']), isPublic: true, usageCount: 32,
      },
    }),
    db.promptTemplate.create({
      data: {
        userId: user.id, name: 'API Design', category: 'development',
        content: 'Design a RESTful API for: {{description}}\n\nRequirements:\n- {{requirements}}\n\nProvide: endpoints, request/response schemas, authentication approach, and error handling strategy.',
        variables: JSON.stringify(['description', 'requirements']), isPublic: false, usageCount: 18,
      },
    }),
    db.promptTemplate.create({
      data: {
        userId: user.id, name: 'Marketing Copy', category: 'marketing',
        content: 'Write compelling marketing copy for:\n\nProduct: {{product_name}}\nTarget Audience: {{audience}}\nKey Features: {{features}}\nTone: {{tone}}\n\nCreate a headline, subheadline, and 3 bullet points.',
        variables: JSON.stringify(['product_name', 'audience', 'features', 'tone']), isPublic: true, usageCount: 56,
      },
    }),
    db.promptTemplate.create({
      data: {
        userId: user.id, name: 'Data Analysis', category: 'analytics',
        content: 'Analyze the following dataset and provide insights:\n\n{{data}}\n\nFocus on: {{focus_areas}}\n\nProvide: key metrics, trends, anomalies, and actionable recommendations.',
        variables: JSON.stringify(['data', 'focus_areas']), isPublic: false, usageCount: 12,
      },
    }),
  ])
  console.log('Created prompt templates')

  // Create token usage entries
  const tokenModels = ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet', 'gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet', 'gpt-4o', 'gpt-4o-mini', 'gpt-4o', 'claude-3.5-sonnet']
  const agentSlugs = ['code-assistant', 'nova', 'code-assistant', 'nova', 'code-assistant', 'nova', 'code-assistant', 'nova', 'code-assistant', 'nova']
  await Promise.all(
    tokenModels.map((model, i) =>
      db.tokenUsage.create({
        data: {
          userId: user.id,
          agentSlug: agentSlugs[i],
          model,
          promptTokens: Math.floor(Math.random() * 2000) + 200,
          completionTokens: Math.floor(Math.random() * 1500) + 100,
          totalTokens: Math.floor(Math.random() * 3500) + 300,
          costUsd: parseFloat((Math.random() * 0.15 + 0.01).toFixed(4)),
          createdAt: new Date(Date.now() - (10 - i) * 86400000),
        },
      })
    )
  )
  console.log('Created token usage entries')

  // Create AI workflows
  await Promise.all([
    db.aiWorkflow.create({
      data: {
        userId: user.id, name: 'Code Review Pipeline', description: 'Automated code review workflow that analyzes PRs and provides feedback',
        nodes: JSON.stringify([
          { id: '1', type: 'trigger', data: { label: 'PR Created', event: 'pull_request.opened' } },
          { id: '2', type: 'llm', data: { label: 'Analyze Code', model: 'gpt-4o', prompt: 'Review this code for issues' } },
          { id: '3', type: 'action', data: { label: 'Post Comment', action: 'github.create_comment' } },
        ]),
        edges: JSON.stringify([{ id: 'e1', source: '1', target: '2' }, { id: 'e2', source: '2', target: '3' }]),
        status: 'active', runCount: 23, lastRunAt: new Date(Date.now() - 86400000),
      },
    }),
    db.aiWorkflow.create({
      data: {
        userId: user.id, name: 'Customer Support Bot', description: 'AI-powered customer support that triages and responds to tickets',
        nodes: JSON.stringify([
          { id: '1', type: 'trigger', data: { label: 'Ticket Created', event: 'ticket.created' } },
          { id: '2', type: 'llm', data: { label: 'Classify Issue', model: 'gpt-4o-mini', prompt: 'Categorize this support ticket' } },
          { id: '3', type: 'condition', data: { label: 'Priority Check', field: 'priority' } },
          { id: '4', type: 'llm', data: { label: 'Draft Response', model: 'claude-3.5-sonnet', prompt: 'Write a helpful response' } },
          { id: '5', type: 'action', data: { label: 'Send Reply', action: 'support.send_reply' } },
        ]),
        edges: JSON.stringify([
          { id: 'e1', source: '1', target: '2' },
          { id: 'e2', source: '2', target: '3' },
          { id: 'e3', source: '3', target: '4' },
          { id: 'e4', source: '4', target: '5' },
        ]),
        status: 'active', runCount: 156, lastRunAt: new Date(Date.now() - 7200000),
      },
    }),
  ])
  console.log('Created AI workflows')

  // Create environment variables
  await Promise.all([
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'DATABASE_URL', value: 'postgresql://dbuser:pass@postgresql.alolabs.net:5432/alolabs_main' } }),
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'REDIS_URL', value: 'redis://default:redis_secret_key@redis.alolabs.net:6379' } }),
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'API_KEY', value: 'alo_k8x2m9p4q7r1s5t3v6w0y' } }),
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'NODE_ENV', value: 'production' } }),
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'PORT', value: '3000' } }),
    db.environmentVariable.create({ data: { userId: user.id, appId: apps[0].id, name: 'SECRET_KEY', value: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } }),
  ])
  console.log('Created environment variables')

  // Create secrets
  await Promise.all([
    db.secret.create({ data: { userId: user.id, appId: apps[0].id, name: 'DB_PASSWORD', value: 'xK9$mP2!vL7@nQ4#', type: 'database' } }),
    db.secret.create({ data: { userId: user.id, appId: apps[0].id, name: 'STRIPE_KEY', value: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', type: 'payment' } }),
    db.secret.create({ data: { userId: user.id, appId: apps[0].id, name: 'JWT_SECRET', value: 'jwt_s3cr3t_k3y_2025_very_l0ng_r4nd0m_str1ng', type: 'auth' } }),
    db.secret.create({ data: { userId: user.id, appId: apps[0].id, name: 'AWS_ACCESS_KEY', value: 'AKIAIOSFODNN7EXAMPLE', type: 'cloud' } }),
  ])
  console.log('Created secrets')

  // Create cron jobs
  await Promise.all([
    db.cronJob.create({
      data: {
        userId: user.id, appId: apps[0].id, name: 'Daily Backup', schedule: '0 2 * * *',
        command: '/usr/bin/backup.sh --full --compress',
        status: 'active', lastRunAt: new Date(Date.now() - 86400000),
        nextRunAt: new Date(Date.now() + 36000000), successCount: 28, failCount: 1,
      },
    }),
    db.cronJob.create({
      data: {
        userId: user.id, appId: apps[0].id, name: 'Log Rotation', schedule: '0 0 * * *',
        command: '/usr/bin/logrotate -f /etc/logrotate.d/app.conf',
        status: 'active', lastRunAt: new Date(Date.now() - 14400000),
        nextRunAt: new Date(Date.now() + 72000000), successCount: 45, failCount: 0,
      },
    }),
    db.cronJob.create({
      data: {
        userId: user.id, appId: apps[0].id, name: 'Health Check', schedule: '*/5 * * * *',
        command: 'curl -sf http://localhost:3000/health || /usr/bin/notify-admin.sh',
        status: 'active', lastRunAt: new Date(Date.now() - 300000),
        nextRunAt: new Date(Date.now() + 270000), successCount: 8640, failCount: 12,
      },
    }),
    db.cronJob.create({
      data: {
        userId: user.id, appId: apps[0].id, name: 'SSL Renewal', schedule: '0 3 1 * *',
        command: 'certbot renew --quiet --deploy-hook "systemctl reload nginx"',
        status: 'active', lastRunAt: new Date(Date.now() - 2592000000),
        nextRunAt: new Date(Date.now() + 2592000000), successCount: 6, failCount: 0,
      },
    }),
  ])
  console.log('Created cron jobs')

  // Create load balancers
  await Promise.all([
    db.loadBalancer.create({
      data: {
        userId: user.id, name: 'Main App LB', protocol: 'https', port: 443,
        algorithm: 'round_robin',
        targets: JSON.stringify([
          { address: '185.243.55.42', port: 3000, weight: 1, healthy: true },
          { address: '185.243.55.43', port: 3000, weight: 1, healthy: true },
        ]),
        sslCertId: certs[0].id, status: 'active',
      },
    }),
    db.loadBalancer.create({
      data: {
        userId: user.id, name: 'API Gateway LB', protocol: 'https', port: 8443,
        algorithm: 'least_connections',
        targets: JSON.stringify([
          { address: '185.243.55.42', port: 8000, weight: 2, healthy: true },
          { address: '185.243.55.43', port: 8000, weight: 1, healthy: true },
        ]),
        sslCertId: certs[1].id, status: 'active',
      },
    }),
  ])
  console.log('Created load balancers')

  // Create service accounts
  await Promise.all([
    db.serviceAccount.create({
      data: {
        userId: user.id, name: 'CI/CD Bot',
        description: 'Service account for GitHub Actions CI/CD pipelines',
        token: 'alo_svc_ci_xK9mP2vL7nQ4rT8wY1zA3bC5dE6fG0hJ',
        permissions: 'write', lastUsedAt: new Date(Date.now() - 3600000),
      },
    }),
    db.serviceAccount.create({
      data: {
        userId: user.id, name: 'Monitoring Service',
        description: 'Service account for internal monitoring and alerting system',
        token: 'alo_svc_mon_pQ4rT8wY1zA3bC5dE6fG0hJ2kL4mN6oP8',
        permissions: 'read', lastUsedAt: new Date(Date.now() - 300000),
      },
    }),
  ])
  console.log('Created service accounts')

  console.log('\n=== Seed completed successfully ===')
  console.log('Login with: demo@alolabs.net / demo1234')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())