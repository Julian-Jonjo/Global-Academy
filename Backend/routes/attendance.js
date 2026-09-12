const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    getRoleId,
    ROLE_IDS
} = require('../middleware/authMiddleware');

// ============================================================
// ROLE CONSTANTS
// ============================================================

const ATTENDANCE_VIEW_ROLES = [
    ROLE_IDS.PROPRIETOR,      // 1
    ROLE_IDS.ADMINISTRATOR,   // 2
    ROLE_IDS.FINANCE,         // 3
    ROLE_IDS.TEACHER,         // 4
    ROLE_IDS.MANAGER          // 6
];

const ATTENDANCE_WRITE_ROLES = [
    ROLE_IDS.PROPRIETOR,      // 1
    ROLE_IDS.ADMINISTRATOR,   // 2
    ROLE_IDS.TEACHER,         // 4
    ROLE_IDS.MANAGER          // 6
];

// ============================================================
// LOCK CONSTANTS
// ------------------------------------------------------------
// A saved attendance record becomes non-editable 72 hours
// after it was FIRST saved (i.e. 72 hours after created_at).
// ============================================================

const LOCK_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours

// ============================================================
// HELPERS
// ============================================================

function getSectorOfUser(user) {
    return String(user?.sector || user?.school_section || '').toLowerCase().trim();
}

function getAllowedSections(sector) {
    if (sector === 'primary') return ['Nursery', 'Primary'];
    if (sector === 'secondary') return ['JSS', 'SSS', 'Secondary'];
    return [];
}

// Returns true if the record is locked (past the 72-hour window).
// `createdAt` is the timestamp of the first save.
function isLocked(createdAt) {
    if (!createdAt) return false;
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created)) return false;
    return (Date.now() - created) > LOCK_WINDOW_MS;
}

// ============================================================
// GET TEACHER'S CLASSES ONLY (For Attendance Register)
// ------------------------------------------------------------
// A teacher only sees classes where they are the CLASS MASTER:
//   - Primary:   every row in primary_class_teachers
//   - Secondary: rows in secondary_class_masters
//
// Subject-teacher assignments (class_subjects) are deliberately
// NOT included, because only class masters may mark attendance.
// ============================================================

router.get(
    '/my-classes',
    authenticateToken,
    requireRoles(...ATTENDANCE_VIEW_ROLES),
    async (req, res) => {
        try {
            const teacherId = req.user.teacher_id;
            if (!teacherId) {
                return res.status(404).json({ message: 'Teacher profile not found.' });
            }

            // 1. Primary class teacher assignments
            const { data: primaryAssignments, error: primaryError } = await supabase
                .from('primary_class_teachers')
                .select(`
                    class_id,
                    classes!class_id (
                        class_id, class_name, arm, school_section, academic_year_id
                    )
                `)
                .eq('teacher_id', teacherId);

            if (primaryError) {
                console.error('PRIMARY ASSIGNMENTS ERROR:', primaryError);
            }

            // 2. Secondary class master assignments
            const { data: secondaryMasters, error: secondaryError } = await supabase
                .from('secondary_class_masters')
                .select(`
                    class_id,
                    classes!class_id (
                        class_id, class_name, arm, school_section, academic_year_id
                    )
                `)
                .eq('teacher_id', teacherId);

            if (secondaryError) {
                console.error('SECONDARY MASTERS ERROR:', secondaryError);
            }

            // 3. Combine and deduplicate
            const classMap = new Map();
            [
                ...(primaryAssignments || []),
                ...(secondaryMasters || [])
            ].forEach(item => {
                if (item.classes) {
                    classMap.set(item.classes.class_id, item.classes);
                }
            });

            const myClasses = Array.from(classMap.values());

            res.json(myClasses);

        } catch (error) {
            console.error('MY CLASSES EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// ============================================================
// GET ALL CLASSES (For Admin / Manager / Proprietor)
// ============================================================

router.get(
    '/all-classes',
    authenticateToken,
    requireRoles(...ATTENDANCE_VIEW_ROLES),
    async (req, res) => {
        try {
            const roleId = getRoleId(req.user);
            const sector = getSectorOfUser(req.user);

            let query = supabase
                .from('classes')
                .select('*')
                .eq('is_active', true)
                .order('school_section')
                .order('class_name')
                .order('arm');

            if (roleId === ROLE_IDS.MANAGER) {
                const allowedSections = getAllowedSections(sector);
                if (!allowedSections.length) {
                    return res.status(403).json({ message: 'Manager sector not configured.' });
                }
                query = query.in('school_section', allowedSections);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.json(data || []);
        } catch (error) {
            console.error('ALL CLASSES EXCEPTION:', error);
            res.status(500).json({ message: 'Failed to load classes' });
        }
    }
);

// ============================================================
// GET ATTENDANCE FOR A CLASS
// ============================================================

router.get(
    '/',
    authenticateToken,
    requireRoles(...ATTENDANCE_VIEW_ROLES),
    async (req, res) => {
        try {
            const { class_id } = req.query;

            if (!class_id) {
                return res.status(400).json({ message: 'class_id is required.' });
            }

            const { data, error } = await supabase
                .from('attendance')
                .select('*')
                .eq('class_id', class_id);

            if (error) {
                console.error('ATTENDANCE FETCH ERROR:', error);
                return res.status(500).json({ message: 'Failed to load attendance', error: error.message });
            }

            res.json(data || []);
        } catch (error) {
            console.error('ATTENDANCE FETCH EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// ============================================================
// SAVE ATTENDANCE FOR MULTIPLE STUDENTS (Bulk Upsert)
// ------------------------------------------------------------
// The 72-hour lock is measured from created_at (first save).
// If a record for (student_id, attendance_date) already exists
// and is older than 72 hours, it is rejected. Otherwise the row
// is upserted; created_at is preserved on update.
// ============================================================

router.post(
    '/bulk',
    authenticateToken,
    requireRoles(...ATTENDANCE_WRITE_ROLES),
    async (req, res) => {
        try {
            const { class_id, attendance_date, records } = req.body;

            if (!class_id || !attendance_date || !Array.isArray(records)) {
                return res.status(400).json({ message: 'class_id, attendance_date, and records array are required.' });
            }

            // Look up existing rows for this class/date so we can:
            //   1. Enforce the 72-hour lock on each existing record.
            //   2. Preserve the original created_at on update.
            const studentIds = records.map(r => r.student_id);

            const { data: existingRows, error: lookupError } = await supabase
                .from('attendance')
                .select('student_id, created_at')
                .eq('class_id', class_id)
                .eq('attendance_date', attendance_date)
                .in('student_id', studentIds);

            if (lookupError) {
                console.error('ATTENDANCE LOOKUP ERROR:', lookupError);
                return res.status(500).json({ message: 'Failed to verify existing attendance', error: lookupError.message });
            }

            const existingByStudent = new Map();
            (existingRows || []).forEach(row => {
                existingByStudent.set(row.student_id, row);
            });

            // Enforce lock on each existing record.
            for (const rec of records) {
                const existing = existingByStudent.get(rec.student_id);
                if (existing && isLocked(existing.created_at)) {
                    return res.status(403).json({
                        message: 'This record is locked. Attendance becomes non-editable 72 hours after it was first saved.'
                    });
                }
            }

            const user = req.user;
            const now = new Date().toISOString();

            // Build insert payload. For existing rows we omit created_at
            // so the database keeps the original timestamp; for new rows
            // we set it to now.
            const insertData = records.map(rec => {
                const existing = existingByStudent.get(rec.student_id);

                const row = {
                    student_id: rec.student_id,
                    class_id: class_id,
                    attendance_date: attendance_date,
                    status: rec.status,
                    recorded_by: user.user_id || null
                };

                if (!existing) {
                    row.created_at = now;
                }

                return row;
            });

            const { data, error } = await supabase
                .from('attendance')
                .upsert(insertData, { onConflict: 'student_id, attendance_date' })
                .select();

            if (error) {
                console.error('ATTENDANCE SAVE ERROR:', error);
                return res.status(500).json({ message: 'Failed to save attendance', error: error.message });
            }

            res.json({ message: 'Attendance saved successfully. Records are locked for 72 hours.', data: data });
        } catch (error) {
            console.error('ATTENDANCE SAVE EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// ============================================================
// DELETE / CLEAR ATTENDANCE FOR A SINGLE STUDENT ON A DATE
// ------------------------------------------------------------
// Same 72-hour lock rule as /bulk, measured from created_at.
// ============================================================

router.delete(
    '/',
    authenticateToken,
    requireRoles(...ATTENDANCE_WRITE_ROLES),
    async (req, res) => {
        try {
            const { student_id, attendance_date } = req.query;

            if (!student_id || !attendance_date) {
                return res.status(400).json({ message: 'student_id and attendance_date are required.' });
            }

            // Look up the existing record (if any) to check the lock.
            const { data: existing, error: lookupError } = await supabase
                .from('attendance')
                .select('created_at')
                .eq('student_id', student_id)
                .eq('attendance_date', attendance_date)
                .maybeSingle();

            if (lookupError) {
                console.error('ATTENDANCE DELETE LOOKUP ERROR:', lookupError);
                return res.status(500).json({ message: 'Failed to verify attendance record', error: lookupError.message });
            }

            if (existing && isLocked(existing.created_at)) {
                return res.status(403).json({
                    message: 'This record is locked. Attendance becomes non-editable 72 hours after it was first saved.'
                });
            }

            const { error } = await supabase
                .from('attendance')
                .delete()
                .eq('student_id', student_id)
                .eq('attendance_date', attendance_date);

            if (error) {
                console.error('ATTENDANCE DELETE ERROR:', error);
                return res.status(500).json({ message: 'Failed to delete attendance', error: error.message });
            }

            res.json({ message: 'Attendance cleared successfully.' });
        } catch (error) {
            console.error('ATTENDANCE DELETE EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

module.exports = router;