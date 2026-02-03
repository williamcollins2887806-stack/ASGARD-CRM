/**
 * Email Routes - Отправка писем
 */

const nodemailer = require('nodemailer');

async function routes(fastify, options) {
  const db = fastify.db;
  
  // Создаём транспорт для отправки
  // Настройки берутся из ENV или БД
  let transporter = null;
  
  async function getTransporter() {
    if (transporter) return transporter;
    
    // Пробуем получить настройки из БД
    try {
      const result = await db.query("SELECT value FROM settings WHERE key = 'smtp_config'");
      if (result.rows.length > 0) {
        const config = JSON.parse(result.rows[0].value);
        transporter = nodemailer.createTransport(config);
        return transporter;
      }
    } catch (e) {}
    
    // Fallback на ENV
    if (process.env.SMTP_HOST) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      return transporter;
    }
    
    // Тестовый транспорт (логирование)
    transporter = {
      sendMail: async (options) => {
        console.log('📧 Email (test mode):', options);
        return { messageId: 'test_' + Date.now() };
      }
    };
    
    return transporter;
  }
  
  // Отправка письма
  fastify.post('/send', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { to, subject, body, attachments = [] } = request.body;
    const user = request.user;
    
    if (!to || !subject) {
      return reply.code(400).send({ error: 'Укажите получателя и тему' });
    }
    
    try {
      const transport = await getTransporter();
      
      const mailOptions = {
        from: process.env.SMTP_FROM || '"АСГАРД CRM" <noreply@asgard-service.ru>',
        to: to,
        subject: subject,
        text: body,
        html: body.replace(/\n/g, '<br>')
      };
      
      // Вложения (если есть)
      if (attachments.length > 0) {
        mailOptions.attachments = attachments.map(a => ({
          filename: a.name || a.filename,
          content: a.content,
          encoding: 'base64'
        }));
      }
      
      const result = await transport.sendMail(mailOptions);
      
      // Логируем отправку
      try {
        await db.query(`
          INSERT INTO email_log (user_id, to_email, subject, status, message_id, created_at)
          VALUES ($1, $2, $3, 'sent', $4, NOW())
        `, [user.id, to, subject, result.messageId]);
      } catch (e) {
        // Таблица может не существовать
      }
      
      return { success: true, messageId: result.messageId };
      
    } catch (error) {
      console.error('Email send error:', error);
      
      // Логируем ошибку
      try {
        await db.query(`
          INSERT INTO email_log (user_id, to_email, subject, status, error, created_at)
          VALUES ($1, $2, $3, 'error', $4, NOW())
        `, [user.id, to, subject, error.message]);
      } catch (e) {}
      
      return reply.code(500).send({ error: 'Ошибка отправки: ' + error.message });
    }
  });
  
  // История отправок
  fastify.get('/history', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    const { limit = 50 } = request.query;
    
    try {
      const result = await db.query(`
        SELECT * FROM email_log 
        WHERE user_id = $1 
        ORDER BY created_at DESC 
        LIMIT $2
      `, [user.id, limit]);
      
      return { history: result.rows };
    } catch (e) {
      return { history: [] };
    }
  });
  
  // Тестовая отправка (проверка настроек)
  fastify.post('/test', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const { email } = request.body;
    const user = request.user;
    
    if (user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только для администратора' });
    }
    
    try {
      const transport = await getTransporter();
      
      await transport.sendMail({
        from: process.env.SMTP_FROM || '"АСГАРД CRM" <noreply@asgard-service.ru>',
        to: email,
        subject: 'Тестовое письмо АСГАРД CRM',
        text: 'Если вы видите это письмо, настройки email работают корректно.',
        html: '<h2>АСГАРД CRM</h2><p>Если вы видите это письмо, настройки email работают корректно.</p>'
      });
      
      return { success: true, message: 'Тестовое письмо отправлено' };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
  
  // Сохранение SMTP настроек
  fastify.post('/settings', {
    preHandler: [fastify.authenticate]
  }, async (request, reply) => {
    const user = request.user;
    
    if (user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Только для администратора' });
    }
    
    const { host, port, secure, user: smtpUser, pass, from } = request.body;
    
    const config = {
      host,
      port: parseInt(port) || 587,
      secure: secure === true || secure === 'true',
      auth: {
        user: smtpUser,
        pass: pass
      }
    };
    
    try {
      await db.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ('smtp_config', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
      `, [JSON.stringify(config)]);
      
      if (from) {
        await db.query(`
          INSERT INTO settings (key, value, updated_at)
          VALUES ('smtp_from', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [from]);
      }
      
      // Сбрасываем кэш транспорта
      transporter = null;
      
      return { success: true };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
}

module.exports = routes;
