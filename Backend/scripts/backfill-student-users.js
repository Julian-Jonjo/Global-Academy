/**
 * One-time backfill: create user accounts for imported students.
 *
 * Run from the Backend folder:
 *     node scripts/backfill-student-users.js --dry-run   (preview only)
 *     node scripts/backfill-student-users.js             (actually insert)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const supabase = require('../Config/db');

const DRY_RUN = process.argv.includes('--dry-run');
const BCRYPT_ROUNDS = 10;

function slugPart(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\s'\-]/g, '');
}

function generateUsername(firstName, lastName) {
    const base =
        `${slugPart(firstName)}.${slugPart(lastName)}` || 'student';
    return base;
}

function generatePassword(admissionNumber) {
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    return `${admissionNumber}-${digits}`;
}

async function findUniqueUsername(base) {
    let candidate = base;
    let suffix = 2;

    for (let attempt = 0; attempt < 100; attempt++) {
        const { data: existing, error } = await supabase
            .from('users')
            .select('user_id')
            .eq('username', candidate)
            .maybeSingle();

        if (error) throw error;
        if (!existing) return candidate;

        candidate = `${base}${suffix}`;
        suffix += 1;
    }

    throw new Error(
        `Could not find a unique username for base "${base}" after 100 attempts.`
    );
}

async function main() {
    console.log('============================================');
    console.log('Student user backfill');
    console.log('Mode:', DRY_RUN ? 'DRY RUN (no inserts)' : 'LIVE (inserting)');
    console.log('============================================\n');

    const { data: students, error: studentsError } = await supabase
        .from('students')
        .select(`
            student_id,
            admission_number,
            first_name,
            middle_name,
            last_name,
            school_section,
            student_status
        `)
        .order('student_id');

    if (studentsError) {
        console.error('Failed to load students:', studentsError);
        process.exit(1);
    }

    console.log(`Total students in DB: ${students.length}`);

    const { data: existingUsers, error: usersError } = await supabase
        .from('users')
        .select('student_id')
        .eq('role_id', 5)
        .not('student_id', 'is', null);

    if (usersError) {
        console.error('Failed to load existing users:', usersError);
        process.exit(1);
    }

    const existingStudentIds = new Set(
        (existingUsers || []).map(u => Number(u.student_id))
    );

    console.log(`Students who already have an account: ${existingStudentIds.size}\n`);

    const toProcess = students.filter(
        s => !existingStudentIds.has(Number(s.student_id))
    );

    console.log(`Students needing an account: ${toProcess.length}\n`);

    if (toProcess.length === 0) {
        console.log('Nothing to do.');
        return;
    }

    let created = 0;
    let errors = 0;

    for (const student of toProcess) {
        try {
            const admission =
                student.admission_number ||
                `GEA-${String(student.student_id).padStart(4, '0')}`;

            const baseUsername = generateUsername(
                student.first_name,
                student.last_name
            );

            const username = DRY_RUN
                ? baseUsername
                : await findUniqueUsername(baseUsername);

            const password = generatePassword(admission);
            const fullName = [
                student.first_name,
                student.middle_name,
                student.last_name
            ]
                .filter(Boolean)
                .join(' ');

            if (DRY_RUN) {
                if (created < 10) {
                    console.log(
                        `[PREVIEW] #${student.student_id} ${fullName}  ->  username="${username}"  password="${password}"`
                    );
                }
                created++;
                continue;
            }

            const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

            const { error: insertError } = await supabase
                .from('users')
                .insert({
                    username,
                    password_hash: passwordHash,
                    portal_password_plain: password,
                    full_name: fullName || null,
                    role_id: 5,
                    sector: student.school_section || null,
                    student_id: student.student_id,
                    is_active: false
                });

            if (insertError) {
                console.error(
                    `[ERROR] student_id=${student.student_id}:`,
                    insertError.message
                );
                errors++;
                continue;
            }

            created++;
            if (created % 25 === 0) {
                console.log(`  ... ${created} created`);
            }
        } catch (err) {
            console.error(
                `[ERROR] student_id=${student.student_id}:`,
                err.message
            );
            errors++;
        }
    }

    console.log('\n============================================');
    console.log('Result');
    console.log('  Created:', created);
    console.log('  Errors :', errors);
    console.log('============================================');

    if (DRY_RUN) {
        console.log('\nThis was a DRY RUN. No rows were written.');
        console.log('Re-run without --dry-run to actually create the accounts.');
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});