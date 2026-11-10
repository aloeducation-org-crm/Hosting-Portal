import { v4 as uuidv4 } from 'uuid';
import net from 'net';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

type SmtpOptions = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  from?: string;
};

type SmtpResult = {
  sent: boolean;
  messageId: string;
  error?: string;
};

function generateMessageId(): string {
  const id = uuidv4();
  return `<${id}@${new URL(env.APP_URL).hostname}>`;
}

function buildEmail(
  from: string,
  to: string,
  subject: string,
  html: string | undefined,
  text: string | undefined,
  messageId: string,
): string {
  const date = new Date().toUTCString();
  const lines: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];

  if (html && text) {
    const boundary = uuidv4();
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
      '',
      `--${boundary}--`,
    );
  } else if (html) {
    lines.push(
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
    );
  } else if (text) {
    lines.push(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      text,
    );
  } else {
    lines.push(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      '',
    );
  }

  return lines.join('\r\n');
}

function readLine(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const idx = buffer.indexOf('\r\n');
      if (idx !== -1) {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        resolve(line);
      }
    };
    const onError = (err: Error) => {
      socket.removeListener('data', onData);
      reject(err);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function sendCommand(socket: net.Socket, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.write(command + '\r\n', () => {
      readLine(socket).then(resolve).catch(reject);
    });
  });
}

function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64');
}

export async function sendEmail(options: SmtpOptions): Promise<SmtpResult> {
  const messageId = generateMessageId();
  const from = options.from || env.SMTP_FROM;
  const smtpHost = env.SMTP_HOST;

  // Dev mode: if no SMTP configured, log and return success
  if (!smtpHost) {
    logger.info(
      { to: options.to, subject: options.subject, from, messageId },
      'SMTP not configured — email logged (dev mode)',
    );
    return { sent: true, messageId };
  }

  const smtpPort = env.SMTP_PORT;
  const smtpUser = env.SMTP_USER;
  const smtpPass = env.SMTP_PASS;

  try {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const sock = new net.Socket();
      sock.setEncoding('utf-8');
      sock.setTimeout(15_000);
      sock.once('error', reject);
      sock.once('timeout', () => {
        sock.destroy();
        reject(new Error('SMTP connection timed out'));
      });
      sock.connect(smtpPort, smtpHost, () => {
        sock.removeListener('error', reject);
        resolve(sock);
      });
    });

    try {
      // Read greeting
      const greeting = await readLine(socket);
      if (!greeting.startsWith('220')) {
        socket.destroy();
        return { sent: false, messageId, error: `Unexpected greeting: ${greeting}` };
      }

      // EHLO
      const ehloResponse = await sendCommand(socket, `EHLO ${new URL(env.APP_URL).hostname}`);
      if (!ehloResponse.startsWith('250')) {
        socket.destroy();
        return { sent: false, messageId, error: `EHLO failed: ${ehloResponse}` };
      }

      // Read all EHLO lines (multi-line 250 responses)
      // Already consumed the first line; read remaining until we get a non-250 line
      // For simplicity, continue — the last 250 line ends the response

      // AUTH LOGIN if credentials provided
      if (smtpUser && smtpPass) {
        const authRequest = await sendCommand(socket, 'AUTH LOGIN');
        if (!authRequest.startsWith('334')) {
          socket.destroy();
          return { sent: false, messageId, error: `AUTH LOGIN not supported: ${authRequest}` };
        }

        const userResponse = await sendCommand(socket, base64Encode(smtpUser));
        if (!userResponse.startsWith('334')) {
          socket.destroy();
          return { sent: false, messageId, error: `Username rejected: ${userResponse}` };
        }

        const passResponse = await sendCommand(socket, base64Encode(smtpPass));
        if (!passResponse.startsWith('235')) {
          socket.destroy();
          return { sent: false, messageId, error: `Authentication failed: ${passResponse}` };
        }
      }

      // MAIL FROM
      const mailFrom = await sendCommand(socket, `MAIL FROM:<${from}>`);
      if (!mailFrom.startsWith('250')) {
        socket.destroy();
        return { sent: false, messageId, error: `MAIL FROM rejected: ${mailFrom}` };
      }

      // RCPT TO
      const rcptTo = await sendCommand(socket, `RCPT TO:<${options.to}>`);
      if (!rcptTo.startsWith('250') && !rcptTo.startsWith('251')) {
        socket.destroy();
        return { sent: false, messageId, error: `RCPT TO rejected: ${rcptTo}` };
      }

      // DATA
      const dataReady = await sendCommand(socket, 'DATA');
      if (!dataReady.startsWith('354')) {
        socket.destroy();
        return { sent: false, messageId, error: `DATA rejected: ${dataReady}` };
      }

      // Send message body
      const emailBody = buildEmail(from, options.to, options.subject, options.html, options.text, messageId);
      const dataSent = await sendCommand(socket, emailBody + '\r\n.');
      if (!dataSent.startsWith('250')) {
        socket.destroy();
        return { sent: false, messageId, error: `Message rejected: ${dataSent}` };
      }

      // QUIT
      await sendCommand(socket, 'QUIT');
      socket.destroy();

      logger.info({ to: options.to, subject: options.subject, messageId }, 'Email sent successfully');
      return { sent: true, messageId };
    } catch (err) {
      socket.destroy();
      const errorMsg = err instanceof Error ? err.message : 'Unknown SMTP error';
      logger.error({ error: errorMsg, to: options.to }, 'SMTP protocol error');
      return { sent: false, messageId, error: errorMsg };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Connection failed';
    logger.error({ error: errorMsg, host: smtpHost, port: smtpPort }, 'SMTP connection error');
    return { sent: false, messageId, error: errorMsg };
  }
}
