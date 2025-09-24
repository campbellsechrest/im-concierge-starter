import fs from 'fs';
import path from 'path';
import { runMigration, testConnection } from '../lib/database/connection.js';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

async function runMigrations() {
  console.log('🗄️ Starting database migrations...');

  // Test connection first
  const connectionTest = await testConnection();
  if (!connectionTest.healthy) {
    console.error('❌ Database connection failed:', connectionTest.error);
    process.exit(1);
  }

  console.log('✅ Database connection healthy');

  // Check if migrations directory exists
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error('❌ Migrations directory not found:', MIGRATIONS_DIR);
    process.exit(1);
  }

  // Get all .sql files in migrations directory
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Run in alphabetical order

  if (migrationFiles.length === 0) {
    console.log('📝 No migration files found');
    return;
  }

  console.log(`📝 Found ${migrationFiles.length} migration file(s):`);
  migrationFiles.forEach(file => console.log(`   - ${file}`));

  // Run each migration
  for (const file of migrationFiles) {
    console.log(`\n🔄 Running migration: ${file}`);

    try {
      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const migrationSql = fs.readFileSync(migrationPath, 'utf8');

      const result = await runMigration(migrationSql);

      if (result.success) {
        console.log(`   ✅ ${file} completed successfully`);
      } else {
        console.error(`   ❌ ${file} failed:`, result.error);
        process.exit(1);
      }
    } catch (error) {
      console.error(`   ❌ ${file} failed:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n🎉 All migrations completed successfully!');
}

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}

export { runMigrations };