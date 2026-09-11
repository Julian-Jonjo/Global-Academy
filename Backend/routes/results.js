const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');
const { authenticateToken, requireRoles, ROLE_IDS } = require('../middleware/authMiddleware');

const VIEW_ROLES = [ROLE_IDS.PROPRIETOR, ROLE_IDS.ADMINISTRATOR, ROLE_IDS.MANAGER, ROLE_IDS.TEACHER];
const WRITE_ROLES = [ROLE_IDS.PROPRIETOR, ROLE_IDS.ADMINISTRATOR, ROLE_IDS.TEACHER, ROLE_IDS.MANAGER];

async function getClassForTeacher(teacherId) {
    const { data: primary } = await supabase.from('primary_class_teachers').select('class_id').eq('teacher_id', teacherId).eq('role', 'Class Master').maybeSingle();
    if (primary) return primary.class_id;
    const { data: secondary } = await supabase.from('secondary_class_masters').select('class_id').eq('teacher_id', teacherId).maybeSingle();
    if (secondary) return secondary.class_id;
    return null;
}

// ============================================================
// 1. GET TEACHER'S ASSIGNED CLASSES & SUBJECTS
// ============================================================
router.get('/my-assignments', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        if (!teacherId) return res.status(404).json({ message: 'Teacher profile not found' });

        // Fetch class_subjects for this teacher
        const { data, error } = await supabase
            .from('class_subjects')
            .select('*, classes!class_id ( class_id, class_name, arm ), subjects!subject_id ( subject_id, subject_name )')
            .eq('teacher_id', teacherId);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('MY ASSIGNMENTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load assignments' });
    }
});

// ============================================================
// 2. GET CLASS MASTER'S CLASS
// ============================================================
router.get('/my-class', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        if (!teacherId) return res.status(404).json({ message: 'Teacher profile not found' });
        const classId = await getClassForTeacher(teacherId);
        if (!classId) return res.json(null);
        const { data, error } = await supabase.from('classes').select('*').eq('class_id', classId).single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('MY CLASS ERROR:', error);
        res.status(500).json({ message: 'Failed to load class' });
    }
});

// ============================================================
// 3. GET CLASS STUDENTS
// ============================================================
router.get('/students/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('student_id, first_name, last_name, gender, date_of_birth, photo_url')
            .eq('class_id', req.params.classId)
            .eq('student_status', 'Active')
            .order('last_name');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('STUDENTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load students' });
    }
});

// ============================================================
// 4. GET ALL SUBJECTS FOR A CLASS
// ============================================================
router.get('/subjects/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('class_subjects')
            .select('*, subjects!subject_id ( subject_id, subject_name )')
            .eq('class_id', req.params.classId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('SUBJECTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load subjects' });
    }
});

// ============================================================
// 5. SAVE GRADES (Subject Teacher / Class Master)
// ============================================================
router.post('/save', authenticateToken, requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
        const { class_id, subject_id, term, records, teacher_id } = req.body;
        // records: [{ student_id, test_score, exam_score }]

        if (!class_id || !subject_id || !term || !Array.isArray(records)) {
            return res.status(400).json({ message: 'Invalid data' });
        }

        const user = req.user;

        // If a subject teacher (not class master), check if already locked & require manager approval
        const classMasterClass = await getClassForTeacher(user.teacher_id);
        const isClassMaster = classMasterClass && Number(classMasterClass) === Number(class_id);

        const insertData = records.map(r => ({
            student_id: r.student_id,
            class_id: class_id,
            subject_id: subject_id,
            term: term,
            test_score: r.test_score || 0,
            exam_score: r.exam_score || 0,
            total_score: (r.test_score || 0) + (r.exam_score || 0),
            academic_year_id: 1
        }));

        // If teacher is not class master, ask for manager approval instead of saving directly
        if (!isClassMaster && user.role_id === ROLE_IDS.TEACHER) {
            // Create a request for manager approval
            const approvalRequests = records.map(r => ({
                teacher_id: user.teacher_id,
                class_id: class_id,
                subject_id: subject_id,
                term: term,
                student_id: r.student_id,
                test_score: r.test_score || 0,
                exam_score: r.exam_score || 0
            }));

            const { error: reqError } = await supabase
                .from('result_edit_requests')
                .insert(approvalRequests);

            if (reqError) throw reqError;
            return res.json({ message: 'Grade changes sent for Manager approval.' });
        }

        // Class Master / Admin / Manager: Save directly
        const { error } = await supabase
            .from('results')
            .upsert(insertData, { onConflict: 'student_id, subject_id, term' });

        if (error) throw error;
        res.json({ message: 'Grades saved successfully!' });
    } catch (error) {
        console.error('SAVE RESULT ERROR:', error);
        res.status(500).json({ message: 'Failed to save grades' });
    }
});

// ============================================================
// 6. GET RESULTS FOR SUBJECT (Teacher view)
// ============================================================
router.get('/subject/:classId/:subjectId/:term', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('results')
            .select('*')
            .eq('class_id', req.params.classId)
            .eq('subject_id', req.params.subjectId)
            .eq('term', req.params.term);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('SUBJECT RESULTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load subject results' });
    }
});

// ============================================================
// 7. GET FULL CLASS RESULTS (For Full Report)
// ============================================================
router.get('/all/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('results')
            .select('*')
            .eq('class_id', req.params.classId)
            .order('term')
            .order('subject_id');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('ALL RESULTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load results' });
    }
});

// ============================================================
// 8. GET SINGLE STUDENT DETAILS
// ============================================================
router.get('/student/:studentId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*, classes!class_id ( class_id, class_name, arm, school_section )')
            .eq('student_id', req.params.studentId)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('STUDENT DETAILS ERROR:', error);
        res.status(500).json({ message: 'Failed to load student details' });
    }
});

// ============================================================
// 9. GET PENDING EDIT REQUESTS (For Manager)
// ============================================================
router.get('/pending-edits/:sector', authenticateToken, requireRoles(ROLE_IDS.MANAGER, ROLE_IDS.ADMINISTRATOR), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('result_edit_requests')
            .select('*')
            .eq('status', 'Pending');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('PENDING EDITS ERROR:', error);
        res.status(500).json({ message: 'Failed to load pending edits' });
    }
});

// ============================================================
// 10. APPROVE / REJECT EDIT REQUESTS (Manager)
// ============================================================
router.put('/review-edit/:requestId', authenticateToken, requireRoles(ROLE_IDS.MANAGER, ROLE_IDS.ADMINISTRATOR), async (req, res) => {
    try {
        const { status } = req.body;
        const requestId = req.params.requestId;

        const { data: requestData } = await supabase
            .from('result_edit_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (!requestData) return res.status(404).json({ message: 'Request not found' });

        if (status === 'Approved') {
            // Save changes to results table
            await supabase
                .from('results')
                .upsert({
                    student_id: requestData.student_id,
                    class_id: requestData.class_id,
                    subject_id: requestData.subject_id,
                    term: requestData.term,
                    test_score: requestData.test_score,
                    exam_score: requestData.exam_score,
                    total_score: requestData.test_score + requestData.exam_score,
                    academic_year_id: 1
                }, { onConflict: 'student_id, subject_id, term' });
        }

        await supabase
            .from('result_edit_requests')
            .update({
                status: status,
                reviewed_by: req.user.user_id,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', requestId);

        res.json({ message: 'Request ' + status });
    } catch (error) {
        console.error('REVIEW EDIT ERROR:', error);
        res.status(500).json({ message: 'Failed to review request' });
    }
});

module.exports = router;