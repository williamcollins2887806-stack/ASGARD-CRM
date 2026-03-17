
const db = require('./src/db');
async function run() {
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL");
  console.log("1. avatar_url OK");

  var tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('chat_messages','messages','chat_group_messages')");
  console.log("Tables found: " + JSON.stringify(tables.rows.map(function(x){return x.table_name})));
  var t = tables.rows[0] ? tables.rows[0].table_name : "chat_messages";

  await db.query("ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text'");
  await db.query("ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS file_url TEXT");
  await db.query("ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS file_duration INTEGER");
  console.log("2. Media columns added to " + t);

  await db.query("CREATE TABLE IF NOT EXISTS user_stories (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), content TEXT, image_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'))");
  console.log("3. user_stories OK");

  var cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url'");
  console.log("avatar_url: " + (cols.rows.length ? "CONFIRMED" : "MISSING"));

  var mcols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = '" + t + "' AND column_name IN ('message_type','file_url','file_duration')");
  console.log("media cols: " + JSON.stringify(mcols.rows.map(function(x){return x.column_name})));

  var st = await db.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'user_stories'");
  console.log("user_stories: " + (st.rows.length ? "CONFIRMED" : "MISSING"));

  process.exit();
}
run().catch(function(e) { console.error(e.message); process.exit(1); });
