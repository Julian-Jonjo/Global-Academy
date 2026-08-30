const bcrypt = require('bcrypt');
const supabase = require('./Config/db');
async function createTestUsers() {
    const users = [
        { username: 'proprietor', password: 'Proprietor@123', full_name: 'School Proprietor', role: 'Proprietor' },
        { username: 'admin', password: 'Admin@123', full_name: 'School Administrator', role: 'Administrator' },
        { username: 'manager.primary', password: 'Primary@123', full_name: 'Primary School Manager', role: 'Manager-Primary' },
        { username: 'manager.secondary', password: 'Secondary@123', full_name: 'Secondary School Manager', role: 'Manager-Secondary' },
        { username: 'finance.primary', password: 'FinanceP@123', full_name: 'Finance Officer Primary', role: 'Finance Officer (Primary)' },
        { username: 'finance.secondary', password: 'FinanceS@123', full_name: 'Finance Officer Secondary', role: 'Finance Officer (Secondary)' },
        { username: 'teacher.primary', password: 'TeacherP@123', full_name: 'Primary Teacher', role: 'Teacher - Primary' },
        { username: 'teacher.secondary', password: 'TeacherS@123', full_name: 'Secondary Teacher', role: 'Teacher - Secondary' }
    ];

    for (const user of users) {
        try {
            const { data: existingUser } = await supabase
                .from('users')
                .select('user_id')
                .eq('username', user.username)
                .maybeSingle();

            if (existingUser) {
                console.log(`SKIPPING ${user.username} - already exists`);
                continue;
            }

            const passwordHash = await bcrypt.hash(user.password, 10);

            const { data: roleData, error: roleError } = await supabase
                .from('user_roles')
                .select('role_id')
                .eq('role_name', user.role)
                .single();

            if (roleError) {
                console.error(`Role not found: ${user.role}`);
                continue;
            }

            const { data, error } = await supabase
                .from('users')
                .insert([{
                    username: user.username,
                    password_hash: passwordHash,
                    full_name: user.full_name,
                    is_active: true,
                    role_id: roleData.role_id
                }])
                .select()
                .single();

            if (error) {
                console.error(`Error creating ${user.username}:`, error.message);
            } else {
                console.log(`Created ${user.username} with role ${user.role}`);
            }

        } catch (error) {
            console.error(`Error processing ${user.username}:`, error.message);
        }
    }
    
    console.log('\nDone!');
}

createTestUsers();