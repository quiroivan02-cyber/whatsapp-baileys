import { db } from "./database.service.js";

const MAX_HISTORY_MESSAGES = 20;

export async function getOrCreateConversation(phoneNumber, contactName = null) {
  const existingConversation = await db.query(
    `
      SELECT id, phone_number, contact_name, created_at, updated_at
      FROM conversations
      WHERE phone_number = $1
    `,
    [phoneNumber]
  );

  if (existingConversation.rows.length > 0) {
    const conversation = existingConversation.rows[0];

    if (contactName && conversation.contact_name !== contactName) {
      const updatedConversation = await db.query(
        `
          UPDATE conversations
          SET contact_name = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, phone_number, contact_name, created_at, updated_at
        `,
        [conversation.id, contactName]
      );

      return updatedConversation.rows[0];
    }

    return conversation;
  }

  const newConversation = await db.query(
    `
      INSERT INTO conversations (phone_number, contact_name)
      VALUES ($1, $2)
      RETURNING id, phone_number, contact_name, created_at, updated_at
    `,
    [phoneNumber, contactName]
  );

  return newConversation.rows[0];
}

export async function addMessageToHistory(phoneNumber, contactName, role, content) {
  const conversation = await getOrCreateConversation(phoneNumber, contactName);

  await db.query(
    `
      INSERT INTO messages (conversation_id, role, content)
      VALUES ($1, $2, $3)
    `,
    [conversation.id, role, content]
  );

  await db.query(
    `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [conversation.id]
  );
}

export async function getConversationHistory(phoneNumber, limit = MAX_HISTORY_MESSAGES) {
  const conversation = await db.query(
    `
      SELECT id
      FROM conversations
      WHERE phone_number = $1
    `,
    [phoneNumber]
  );

  if (conversation.rows.length === 0) {
    return [];
  }

  const conversationId = conversation.rows[0].id;

  const messages = await db.query(
    `
      SELECT role, content, created_at
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [conversationId, limit]
  );

  return messages.rows.reverse();
}

export async function clearConversationHistory(phoneNumber) {
  const conversation = await db.query(
    `
      SELECT id
      FROM conversations
      WHERE phone_number = $1
    `,
    [phoneNumber]
  );

  if (conversation.rows.length === 0) {
    return false;
  }

  await db.query(
    `
      DELETE FROM messages
      WHERE conversation_id = $1
    `,
    [conversation.rows[0].id]
  );

  await db.query(
    `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [conversation.rows[0].id]
  );

  return true;
}