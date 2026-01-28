import { DataSource } from 'typeorm';
import { User } from './users/user.entity';
import * as bcrypt from 'bcrypt';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'admin',
    password: process.env.DB_PASS || 'change_me',
    database: process.env.DB_NAME || 'app_db',
    entities: [User],
    synchronize: true,
  });

  try {
    await dataSource.initialize();
    console.log('Database connection established');

    const userRepository = dataSource.getRepository(User);

    // Check if admin user already exists
    const existingAdmin = await userRepository.findOne({ where: { email: 'admin@example.com' } });
    
    if (existingAdmin) {
      // Update existing admin user with password if it doesn't have one
      if (!existingAdmin.password) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        existingAdmin.password = hashedPassword;
        existingAdmin.role = 'admin';
        await userRepository.save(existingAdmin);
        console.log('Admin user updated with password');
      } else {
        console.log('Admin user already exists with password');
      }
    } else {
      // Create admin user
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const adminUser = userRepository.create({
        email: 'admin@example.com',
        name: 'Admin User',
        password: hashedPassword,
        role: 'admin',
      });

      await userRepository.save(adminUser);
      console.log('Admin user created successfully');
    }
    
    console.log('Email: admin@example.com');
    console.log('Password: admin123');

    await dataSource.destroy();
    console.log('Seed completed successfully');
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

seed();
