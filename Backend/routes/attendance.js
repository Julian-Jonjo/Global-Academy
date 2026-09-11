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
// HELPER: Get User's Sector
// ============================================================

function getSectorOfUser(user) {
    return String(user?.sector || user?.school_section || '').toLowerCase().trim();
}

function getAllowedSections(sector) {
    if (sector === 'primary') return ['Nursery', 'Primary'];
    if (sector === 'secondary') return ['JSS', 'SSS', 'Secondary'];
    return [];
}

// ============================================================
// GET TEACHER'S CLASSES ONLY (For Attendance Register)
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

            // 1. Fetch Primary Classes
            const { data: primaryAssignments } = await supabase
                .from('primary_class_teachers')
                .select(`
                    class_id,
                    classes!class_id (
                        class_id, class_name, arm, school_section, academic_year_id
                    )
                `)
                .eq('teacher_id', teacherId);

            // 2. Fetch Secondary Class Master Classes
            const { data: secondaryMasters } = await supabase
                .from('secondary_class_masters')
                .select(`
                    class_id,
                    classes!class_id (
                        class_id, class_name, arm, school_section, academic_year_id
                    )
                `)
                .eq('teacher_id', teacherId);

            // 3. Fetch Secondary Subject Classes
            const { data: subjectAssignments } = await supabase
                .from('class_subjects')
                .select(`
                    class_id,
                    classes!class_id (
                        class_id, class_name, arm, school_section, academic_year_id
                    )
                `)
                .eq('teacher_id', teacherId);

            // Combine and deduplicate classes
            const classMap = new Map();
            [
                ...(primaryAssignments || []),
                ...(secondaryMasters || []),
                ...(subjectAssignments || [])
            ].forEach(item => {
                if (item.classes) {
                    classMap.set(item.classes.class_id, item.classes);
                }
            });

            const myClasses = Array.from(classMap.values());

            // 4. Return only the teacher's classes
            res.json(myClasses);

        } catch (error) {
            console.error('MY CLASSES EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// ============================================================
// GET ALL CLASSES (For Admin/Manager/Proprietor)
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
// GET ATTENDANCE FOR A CLASS ON A SPECIFIC DATE
// ============================================================

// ============================================================
// GET ATTENDANCE FOR A CLASS (Fetch all records for the class)
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
// ============================================================

router.post(
    '/bulk',
    authenticateToken,
    requireRoles(...ATTENDANCE_WRITE_ROLES),
    async (req, res) => {
        try {
            const { class_id, attendance_date, records } = req.body; 
            // records: [{ student_id, status }]

            if (!class_id || !attendance_date || !Array.isArray(records)) {
                return res.status(400).json({ message: 'class_id, attendance_date, and records array are required.' });
            }

            // 🛑 SECURITY: 24-Hour Lock Check
            const requestedDate = new Date(attendance_date + 'T00:00:00');
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (requestedDate < twentyFourHoursAgo) {
                return res.status(403).json({ 
                    message: 'This record is locked. Attendance becomes non-editable 24 hours after it was first saved.' 
                });
            }

            const user = req.user;
            const now = new Date().toISOString();

            const insertData = records.map(rec => ({
                student_id: rec.student_id,
                class_id: class_id,
                attendance_date: attendance_date,
                status: rec.status, // 'Present' or 'Absent'
                recorded_by: user.user_id || null,
                created_at: now
            }));

            // Upsert: updates existing records or inserts new ones
            const { data, error } = await supabase
                .from('attendance')
                .upsert(insertData, { onConflict: 'student_id, attendance_date' })
                .select();

            if (error) {
                console.error('ATTENDANCE SAVE ERROR:', error);
                return res.status(500).json({ message: 'Failed to save attendance', error: error.message });
            }

            res.json({ message: 'Attendance saved successfully. Records are locked for 24 hours.', data: data });
        } catch (error) {
            console.error('ATTENDANCE SAVE EXCEPTION:', error);
            res.status(500).json({ message: 'Server error' });
        }
    }
);

// ============================================================
// DELETE / CLEAR ATTENDANCE FOR A SINGLE STUDENT ON A DATE
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

            // 🛑 SECURITY: 24-Hour Lock Check
            const requestedDate = new Date(attendance_date + 'T00:00:00');
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (requestedDate < twentyFourHoursAgo) {
                return res.status(403).json({ 
                    message: 'This record is locked. Attendance becomes non-editable 24 hours after it was first saved.' 
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