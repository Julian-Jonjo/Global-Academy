const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    getRoleId,
    getSector,
    ROLE_IDS
} = require('../middleware/authMiddleware');

const router = express.Router();

const PROPRIETOR = ROLE_IDS.PROPRIETOR;       // 1
const ADMINISTRATOR = ROLE_IDS.ADMINISTRATOR; // 2
const MANAGER = ROLE_IDS.MANAGER;             // 6

/* =========================================================
   HELPERS
   ========================================================= */

function normalizeSector(value) {
    return String(value || '').trim().toLowerCase();
}

function managerCanManageSection(user, schoolSection) {
    if (getRoleId(user) !== MANAGER) {
        return false;
    }

    const userSector = normalizeSector(getSector(user));
    const target = normalizeSector(schoolSection);

    if (userSector === 'primary') {
        return target === 'nursery' || target === 'primary';
    }

    if (userSector === 'secondary') {
        return target === 'jss' ||
               target === 'sss' ||
               target === 'secondary';
    }

    return false;
}

async function loadStudentSection(studentId) {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id,
            school_section,
            classes (
                class_id,
                school_section
            )
        `)
        .eq('student_id', studentId)
        .maybeSingle();

    if (error) throw error;

    if (!data) return null;

    return data.classes?.school_section ||
           data.school_section ||
           null;
}


/* =========================================================
   GET ALL DISCIPLINE RECORDS
   ========================================================= */

router.get(
    '/',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);

            let query = supabase
                .from('discipline_records')
                .select('*')
                .order('incident_date', { ascending: false });

            if (roleId === MANAGER) {

                const sector = normalizeSector(getSector(req.user));

                let allowedSections;

                if (sector === 'primary') {
                    allowedSections = ['Nursery', 'Primary'];
                } else if (sector === 'secondary') {
                    allowedSections = ['JSS', 'SSS', 'Secondary'];
                } else {
                    return res.status(403).json({
                        message: 'Manager sector is not configured correctly.'
                    });
                }

                query = query.in('school_section', allowedSections);
            }

            if (req.query.status) {
                query = query.eq('status', req.query.status);
            }

            if (req.query.student_id) {
                query = query.eq('student_id', req.query.student_id);
            }

            const { data, error } = await query;

            if (error) throw error;

            return res.json(data || []);

        } catch (error) {

            console.error('GET DISCIPLINE ERROR:', error);

            return res.status(500).json({
                message: 'Failed to load discipline records.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET DISCIPLINE RECORDS FOR ONE STUDENT
   ========================================================= */

router.get(
    '/student/:studentId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const studentId = req.params.studentId;

            if (roleId === MANAGER) {
                const section = await loadStudentSection(studentId);

                if (!section) {
                    return res.status(404).json({
                        message: 'Student not found.'
                    });
                }

                if (!managerCanManageSection(req.user, section)) {
                    return res.status(403).json({
                        message: 'Access denied. Student belongs to another sector.'
                    });
                }
            }

            const { data, error } = await supabase
                .from('discipline_records')
                .select('*')
                .eq('student_id', studentId)
                .order('incident_date', { ascending: false });

            if (error) throw error;

            return res.json(data || []);

        } catch (error) {

            console.error('GET STUDENT DISCIPLINE ERROR:', error);

            return res.status(500).json({
                message: 'Failed to load discipline records.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   CREATE DISCIPLINE RECORD
   ========================================================= */

router.post(
    '/',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const body = req.body || {};

            const studentId = body.student_id;
            const incidentDate = body.incident_date;
            const crime = String(body.crime || '').trim();
            const description = String(body.description || '').trim();
            const punishment = String(body.punishment || '').trim();
            const hearingOfficer = String(body.hearing_officer || '').trim();

            if (
                !studentId ||
                !incidentDate ||
                !crime ||
                !description ||
                !punishment ||
                !hearingOfficer
            ) {
                return res.status(400).json({
                    message:
                        'student_id, incident_date, crime, description, punishment, and hearing_officer are required.'
                });
            }

            const section = await loadStudentSection(studentId);

            if (!section) {
                return res.status(404).json({
                    message: 'Student not found.'
                });
            }

            if (roleId === MANAGER) {
                if (!managerCanManageSection(req.user, section)) {
                    return res.status(403).json({
                        message:
                            'Access denied. Student belongs to another sector.'
                    });
                }
            }

            const payload = {
                student_id: studentId,
                incident_date: incidentDate,
                crime,
                description,
                punishment,
                duration: body.duration || null,
                hearing_officer: hearingOfficer,
                notes: body.notes || null,
                status: body.status || 'Active',
                school_section: section,
                recorded_by: req.user.user_id || null
            };

            const { data, error } = await supabase
                .from('discipline_records')
                .insert(payload)
                .select()
                .single();

            if (error) throw error;

            return res.status(201).json({
                message: 'Discipline record saved.',
                record: data
            });

        } catch (error) {

            console.error('CREATE DISCIPLINE ERROR:', error);

            return res.status(500).json({
                message: 'Failed to save discipline record.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   UPDATE DISCIPLINE RECORD
   ========================================================= */

router.put(
    '/:disciplineId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const disciplineId = req.params.disciplineId;

            const { data: existing, error: existingErr } = await supabase
                .from('discipline_records')
                .select('*')
                .eq('discipline_id', disciplineId)
                .maybeSingle();

            if (existingErr) throw existingErr;

            if (!existing) {
                return res.status(404).json({
                    message: 'Discipline record not found.'
                });
            }

            if (roleId === MANAGER) {
                if (!managerCanManageSection(req.user, existing.school_section)) {
                    return res.status(403).json({
                        message:
                            'Access denied. Record belongs to another sector.'
                    });
                }
            }

            const body = req.body || {};
            const update = {};

            const editable = [
                'incident_date',
                'crime',
                'description',
                'punishment',
                'duration',
                'hearing_officer',
                'notes',
                'status'
            ];

            for (const field of editable) {
                if (body[field] !== undefined) {
                    update[field] = body[field] === '' ? null : body[field];
                }
            }

            if (!Object.keys(update).length) {
                return res.status(400).json({
                    message: 'Nothing to update.'
                });
            }

            update.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('discipline_records')
                .update(update)
                .eq('discipline_id', disciplineId)
                .select()
                .single();

            if (error) throw error;

            return res.json({
                message: 'Discipline record updated.',
                record: data
            });

        } catch (error) {

            console.error('UPDATE DISCIPLINE ERROR:', error);

            return res.status(500).json({
                message: 'Failed to update discipline record.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   DELETE DISCIPLINE RECORD
   ========================================================= */

router.delete(
    '/:disciplineId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const disciplineId = req.params.disciplineId;

            const { data: existing, error: existingErr } = await supabase
                .from('discipline_records')
                .select('*')
                .eq('discipline_id', disciplineId)
                .maybeSingle();

            if (existingErr) throw existingErr;

            if (!existing) {
                return res.status(404).json({
                    message: 'Discipline record not found.'
                });
            }

            if (roleId === MANAGER) {
                if (!managerCanManageSection(req.user, existing.school_section)) {
                    return res.status(403).json({
                        message:
                            'Access denied. Record belongs to another sector.'
                    });
                }
            }

            const { error } = await supabase
                .from('discipline_records')
                .delete()
                .eq('discipline_id', disciplineId);

            if (error) throw error;

            return res.json({
                message: 'Discipline record deleted.'
            });

        } catch (error) {

            console.error('DELETE DISCIPLINE ERROR:', error);

            return res.status(500).json({
                message: 'Failed to delete discipline record.',
                error: error.message
            });
        }
    }
);


module.exports = router;