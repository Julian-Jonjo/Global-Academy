const express = require('express');
const router = express.Router();

const supabase = require('../Config/db');

const {
    authenticateToken,
    getRoleId,
    ROLE_IDS
} = require('../middleware/authMiddleware');

/* ============================================================
   ROLE CONSTANTS
   ============================================================ */

const PROPRIETOR    = ROLE_IDS.PROPRIETOR;
const ADMINISTRATOR = ROLE_IDS.ADMINISTRATOR;
const FINANCE       = ROLE_IDS.FINANCE;
const MANAGER       = ROLE_IDS.MANAGER;
const ADMIN_OFFICER = ROLE_IDS.ADMIN_OFFICER;

/* Who can edit the catalog (add/edit/remove fees + fee types) */
const CATALOG_WRITE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE
];

/* Who can assign a class's catalog to a student */
const ASSIGN_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE
];

/* Who can create waivers */
const WAIVER_CREATE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE
];

/* Who can auto-approve their own waivers */
const WAIVER_AUTO_APPROVE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR
];

/* Who can approve/reject waivers from others */
const WAIVER_APPROVE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR
];

/* Who can read anything */
const READ_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE,
    MANAGER,
    ADMIN_OFFICER
];

/* ============================================================
   HELPERS
   ============================================================ */

function hasRole(user, roles) {
    return roles.includes(getRoleId(user));
}

function userIdOf(user) {
    return Number(user?.user_id) || null;
}

async function resolveAcademicYearId(requestedYear) {
    if (requestedYear) {
        const { data } = await supabase
            .from('academic_years')
            .select('academic_year_id')
            .eq('year_name', requestedYear)
            .maybeSingle();
        if (data) return data.academic_year_id;
    }

    const { data: current } = await supabase
        .from('academic_years')
        .select('academic_year_id')
        .eq('is_current', true)
        .maybeSingle();

    return current?.academic_year_id || null;
}

function parseId(value) {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/* ============================================================
   FEE TYPES — CRUD
   ============================================================ */

router.get(
    '/types',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, READ_ROLES)) {
                return res.status(403).json({ message: 'Access denied.' });
            }

            const { data, error } = await supabase
                .from('fee_types')
                .select('*')
                .order('fee_name', { ascending: true });

            if (error) throw error;

            res.json({ types: data || [] });
        } catch (error) {
            console.error('GET /fees/types ERROR:', error);
            res.status(500).json({ message: 'Failed to load fee types.', error: error.message });
        }
    }
);

router.post(
    '/types',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot add fee types.' });
            }

            const { fee_name, description } = req.body || {};

            if (!fee_name || !String(fee_name).trim()) {
                return res.status(400).json({ message: 'fee_name is required.' });
            }

            const { data: existing } = await supabase
                .from('fee_types')
                .select('fee_type_id')
                .ilike('fee_name', String(fee_name).trim())
                .maybeSingle();

            if (existing) {
                return res.status(409).json({ message: 'That fee type already exists.' });
            }

            const { data, error } = await supabase
                .from('fee_types')
                .insert({
                    fee_name: String(fee_name).trim(),
                    description: description || null,
                    is_active: true
                })
                .select()
                .single();

            if (error) throw error;

            res.status(201).json({ type: data });
        } catch (error) {
            console.error('POST /fees/types ERROR:', error);
            res.status(500).json({ message: 'Failed to create fee type.', error: error.message });
        }
    }
);

router.put(
    '/types/:feeTypeId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot edit fee types.' });
            }

            const feeTypeId = parseId(req.params.feeTypeId);
            if (!feeTypeId) {
                return res.status(400).json({ message: 'Invalid fee_type_id.' });
            }

            const updates = {};
            if (typeof req.body.fee_name === 'string') {
                updates.fee_name = req.body.fee_name.trim();
            }
            if (typeof req.body.description === 'string' || req.body.description === null) {
                updates.description = req.body.description;
            }
            if (typeof req.body.is_active === 'boolean') {
                updates.is_active = req.body.is_active;
            }

            if (!Object.keys(updates).length) {
                return res.status(400).json({ message: 'No fields to update.' });
            }

            const { data, error } = await supabase
                .from('fee_types')
                .update(updates)
                .eq('fee_type_id', feeTypeId)
                .select()
                .single();

            if (error) throw error;

            res.json({ type: data });
        } catch (error) {
            console.error('PUT /fees/types/:id ERROR:', error);
            res.status(500).json({ message: 'Failed to update fee type.', error: error.message });
        }
    }
);

router.delete(
    '/types/:feeTypeId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot deactivate fee types.' });
            }

            const feeTypeId = parseId(req.params.feeTypeId);
            if (!feeTypeId) {
                return res.status(400).json({ message: 'Invalid fee_type_id.' });
            }

            const { error } = await supabase
                .from('fee_types')
                .update({ is_active: false })
                .eq('fee_type_id', feeTypeId);

            if (error) throw error;

            res.json({ message: 'Fee type deactivated.' });
        } catch (error) {
            console.error('DELETE /fees/types/:id ERROR:', error);
            res.status(500).json({ message: 'Failed to deactivate fee type.', error: error.message });
        }
    }
);

/* ============================================================
   FEE CATALOG — CRUD (per class)
   ============================================================ */

router.get(
    '/catalog',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, READ_ROLES)) {
                return res.status(403).json({ message: 'Access denied.' });
            }

            const { class_id, academic_year } = req.query;
            const academicYearId = await resolveAcademicYearId(academic_year);

                        let query = supabase
                .from('fee_catalog')
                .select(`
                    id,
                    class_id,
                    fee_type_id,
                    name,
                    description,
                    amount,
                    sector,
                    academic_year_id,
                    is_active,
                    effective_from,
                    updated_at,
                    fee_types ( fee_name )
                `)
                .order('name', { ascending: true });

            if (class_id) {
                const cid = parseId(class_id);
                if (!cid) return res.status(400).json({ message: 'Invalid class_id.' });
                query = query.eq('class_id', cid);
            }

            if (academicYearId) {
                query = query.eq('academic_year_id', academicYearId);
            }

            const { data, error } = await query;
            if (error) throw error;

            res.json({ catalog: data || [] });
        } catch (error) {
            console.error('GET /fees/catalog ERROR:', error);
            res.status(500).json({ message: 'Failed to load catalog.', error: error.message });
        }
    }
);

router.post(
    '/catalog',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot add catalog entries.' });
            }

            const {
                class_id,
                fee_type_id,
                amount,
                academic_year,
                description,
                effective_from
            } = req.body || {};

            const cid = parseId(class_id);
            const ftid = parseId(fee_type_id);
            const amt = Number(amount);
            const yearId = await resolveAcademicYearId(academic_year);

            if (!cid) return res.status(400).json({ message: 'class_id is required.' });
            if (!ftid) return res.status(400).json({ message: 'fee_type_id is required.' });
            if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ message: 'amount must be a number >= 0.' });
            if (!yearId) return res.status(400).json({ message: 'Could not determine academic year.' });

            const { data: classRow, error: classErr } = await supabase
                .from('classes')
                .select('class_id, school_section')
                .eq('class_id', cid)
                .maybeSingle();

            if (classErr) throw classErr;
            if (!classRow) return res.status(404).json({ message: 'Class not found.' });

            const { data: typeRow, error: typeErr } = await supabase
                .from('fee_types')
                .select('fee_type_id, fee_name')
                .eq('fee_type_id', ftid)
                .maybeSingle();

            if (typeErr) throw typeErr;
            if (!typeRow) return res.status(404).json({ message: 'Fee type not found.' });

            const sector =
                ['Nursery', 'Primary'].includes(classRow.school_section)
                    ? 'primary'
                    : 'secondary';

            const effectiveFrom = effective_from || new Date().toISOString().slice(0, 10);

                        const { data, error } = await supabase
                .from('fee_catalog')
                .insert({
                    class_id: cid,
                    fee_type_id: ftid,
                    name: typeRow.fee_name,
                    description: description || null,
                    amount: amt,
                    sector,
                    academic_year_id: yearId,
                    is_active: true,
                    effective_from: effectiveFrom
                })
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({ message: 'This fee already exists for that class in this academic year.' });
                }
                throw error;
            }

            res.status(201).json({ catalog: data });
        } catch (error) {
            console.error('POST /fees/catalog ERROR:', error);
            res.status(500).json({ message: 'Failed to create catalog entry.', error: error.message });
        }
    }
);

router.put(
    '/catalog/:catalogId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot edit catalog entries.' });
            }

            const catalogId = req.params.catalogId;
            if (!catalogId) return res.status(400).json({ message: 'Invalid catalog id.' });

            const updates = {};
            if (req.body.amount !== undefined) {
                const amt = Number(req.body.amount);
                if (!Number.isFinite(amt) || amt < 0) {
                    return res.status(400).json({ message: 'amount must be a number >= 0.' });
                }
                updates.amount = amt;
            }
            if (typeof req.body.description === 'string' || req.body.description === null) {
                updates.description = req.body.description;
            }
            if (typeof req.body.is_active === 'boolean') {
                updates.is_active = req.body.is_active;
            }
            if (typeof req.body.effective_from === 'string') {
                updates.effective_from = req.body.effective_from;
            }
            updates.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('fee_catalog')
                .update(updates)
                .eq('id', catalogId)
                .select()
                .single();

            if (error) throw error;

            res.json({ catalog: data });
        } catch (error) {
            console.error('PUT /fees/catalog/:id ERROR:', error);
            res.status(500).json({ message: 'Failed to update catalog entry.', error: error.message });
        }
    }
);

router.delete(
    '/catalog/:catalogId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, CATALOG_WRITE_ROLES)) {
                return res.status(403).json({ message: 'You cannot remove catalog entries.' });
            }

            const catalogId = req.params.catalogId;
            if (!catalogId) return res.status(400).json({ message: 'Invalid catalog id.' });

            const { error } = await supabase
                .from('fee_catalog')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', catalogId);

            if (error) throw error;

            res.json({ message: 'Catalog entry deactivated.' });
        } catch (error) {
            console.error('DELETE /fees/catalog/:id ERROR:', error);
            res.status(500).json({ message: 'Failed to deactivate catalog entry.', error: error.message });
        }
    }
);

/* ============================================================
   STUDENT FEES — apply catalog to a student
   ============================================================ */

router.get(
    '/students/:studentId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, READ_ROLES)) {
                return res.status(403).json({ message: 'Access denied.' });
            }

            const studentId = parseId(req.params.studentId);
            if (!studentId) return res.status(400).json({ message: 'Invalid student id.' });

            const { data: student, error: studentErr } = await supabase
                .from('students')
                .select(`
                    student_id, first_name, middle_name, last_name,
                    admission_number, class_id, school_section,
                    classes ( class_id, class_name, arm, school_section )
                `)
                .eq('student_id', studentId)
                .maybeSingle();

            if (studentErr) throw studentErr;
            if (!student) return res.status(404).json({ message: 'Student not found.' });

            const { data: fees, error: feesErr } = await supabase
                .from('student_fees')
                .select(`
                    student_fee_id,
                    fee_type_id,
                    amount_due,
                    academic_year_id,
                    catalog_id,
                    is_active,
                    fee_types ( fee_name )
                `)
                .eq('student_id', studentId)
                .eq('is_active', true)
                .order('student_fee_id', { ascending: true });

            if (feesErr) throw feesErr;

            res.json({ student, fees: fees || [] });
        } catch (error) {
            console.error('GET /fees/students/:id ERROR:', error);
            res.status(500).json({ message: 'Failed to load student fees.', error: error.message });
        }
    }
);

router.post(
    '/students/:studentId/apply',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, ASSIGN_ROLES)) {
                return res.status(403).json({ message: 'You cannot assign fees.' });
            }

            const studentId = parseId(req.params.studentId);
            if (!studentId) return res.status(400).json({ message: 'Invalid student id.' });

            const { academic_year } = req.body || {};
            const yearId = await resolveAcademicYearId(academic_year);
            if (!yearId) return res.status(400).json({ message: 'Could not determine academic year.' });

            const { data: student, error: studentErr } = await supabase
                .from('students')
                .select('student_id, class_id')
                .eq('student_id', studentId)
                .maybeSingle();

            if (studentErr) throw studentErr;
            if (!student) return res.status(404).json({ message: 'Student not found.' });
            if (!student.class_id) return res.status(400).json({ message: 'Student has no class.' });

            const { data: catalog, error: catErr } = await supabase
                .from('fee_catalog')
                .select('id, fee_type_id, name, description, amount, academic_year_id')
                .eq('class_id', student.class_id)
                .eq('academic_year_id', yearId)
                .eq('is_active', true);

            if (catErr) throw catErr;

            if (!catalog || !catalog.length) {
                return res.status(400).json({ message: 'No catalog fees found for this class in this academic year.' });
            }

            /* Fetch existing active student_fees for this year to avoid duplicates */
            const { data: existing, error: exErr } = await supabase
                .from('student_fees')
                .select('fee_type_id')
                .eq('student_id', studentId)
                .eq('academic_year_id', yearId)
                .eq('is_active', true);

            if (exErr) throw exErr;

            const existingTypes = new Set((existing || []).map(r => r.fee_type_id));

            const rows = catalog
                .filter(c => !existingTypes.has(c.fee_type_id))
                .map(c => ({
                    student_id: studentId,
                    fee_type_id: c.fee_type_id,
                    amount_due: c.amount,
                    academic_year_id: yearId,
                    catalog_id: c.id,
                    is_active: true
                }));

            if (!rows.length) {
                return res.json({ message: 'Nothing to assign. All catalog fees already on this student.', inserted: 0 });
            }

            const { data, error } = await supabase
                .from('student_fees')
                .insert(rows)
                .select();

            if (error) throw error;

            res.status(201).json({ message: 'Fees assigned.', inserted: data.length, rows: data });
        } catch (error) {
            console.error('POST /fees/students/:id/apply ERROR:', error);
            res.status(500).json({ message: 'Failed to assign fees.', error: error.message });
        }
    }
);

router.delete(
    '/students/:studentId/fees/:studentFeeId',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, ASSIGN_ROLES)) {
                return res.status(403).json({ message: 'You cannot remove fees.' });
            }

            const studentId = parseId(req.params.studentId);
            const studentFeeId = parseId(req.params.studentFeeId);
            if (!studentId || !studentFeeId) return res.status(400).json({ message: 'Invalid id.' });

            const { error } = await supabase
                .from('student_fees')
                .update({ is_active: false })
                .eq('student_fee_id', studentFeeId)
                .eq('student_id', studentId);

            if (error) throw error;

            res.json({ message: 'Fee removed from student.' });
        } catch (error) {
            console.error('DELETE /fees/students/:id/fees/:feeId ERROR:', error);
            res.status(500).json({ message: 'Failed to remove fee.', error: error.message });
        }
    }
);

/* ============================================================
   WAIVERS
   ============================================================ */

router.get(
    '/waivers',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, READ_ROLES)) {
                return res.status(403).json({ message: 'Access denied.' });
            }

            const { status, student_id, academic_year } = req.query;
            const yearId = await resolveAcademicYearId(academic_year);

            let query = supabase
                .from('student_fee_waivers')
                .select(`
                    *,
                    students ( student_id, first_name, middle_name, last_name, admission_number, class_id,
                               classes ( class_id, class_name, arm, school_section ) ),
                    student_fees ( student_fee_id, amount_due, fee_types ( fee_name ) )
                `)
                .order('requested_at', { ascending: false });

            if (status) query = query.eq('status', status);
            if (student_id) {
                const sid = parseId(student_id);
                if (!sid) return res.status(400).json({ message: 'Invalid student_id.' });
                query = query.eq('student_id', sid);
            }
            if (yearId) query = query.eq('academic_year_id', yearId);

            const { data, error } = await query;
            if (error) throw error;

            res.json({ waivers: data || [] });
        } catch (error) {
            console.error('GET /fees/waivers ERROR:', error);
            res.status(500).json({ message: 'Failed to load waivers.', error: error.message });
        }
    }
);

router.post(
    '/waivers',
    authenticateToken,
    async (req, res) => {
        try {
            const roleId = getRoleId(req.user);
            if (!hasRole(req.user, WAIVER_CREATE_ROLES)) {
                return res.status(403).json({ message: 'You cannot create waivers.' });
            }

            const {
                student_id,
                student_fee_id,
                waive_type,
                waive_amount,
                reason,
                academic_year
            } = req.body || {};

            const sid = parseId(student_id);
            if (!sid) return res.status(400).json({ message: 'student_id is required.' });

            if (waive_type !== 'full' && waive_type !== 'amount') {
                return res.status(400).json({ message: 'waive_type must be "full" or "amount".' });
            }

            if (!reason || !String(reason).trim()) {
                return res.status(400).json({ message: 'reason is required.' });
            }

            const yearId = await resolveAcademicYearId(academic_year);
            if (!yearId) return res.status(400).json({ message: 'Could not determine academic year.' });

            /* For 'full', student_fee_id is required */
                       let feeId = null;
            let waiveAmt = null;

            if (waive_type === 'full') {
                feeId = parseId(student_fee_id);
                if (!feeId) {
                    return res.status(400).json({ message: 'student_fee_id required for full waiver.' });
                }

                const { data: feeRow, error: feeErr } = await supabase
                    .from('student_fees')
                    .select('student_fee_id, student_id')
                    .eq('student_fee_id', feeId)
                    .maybeSingle();

                if (feeErr) throw feeErr;
                if (!feeRow) return res.status(404).json({ message: 'Fee row not found.' });
                if (feeRow.student_id !== sid) return res.status(400).json({ message: 'Fee row does not belong to this student.' });
            } else {
                waiveAmt = Number(waive_amount);
                if (!Number.isFinite(waiveAmt) || waiveAmt <= 0) {
                    return res.status(400).json({ message: 'waive_amount must be > 0.' });
                }
            }

            /* Block waiver if the fee already has approved payments.
               Refund instead — do not waive paid fees. */
            if (feeId) {
                const { data: paidRows } = await supabase
                    .from('payments')
                    .select('amount_paid, payment_type')
                    .eq('student_id', sid)
                    .eq('student_fee_id', feeId)
                    .eq('approval_status', 'approved');

                const netPaid = (paidRows || []).reduce(
                    (sum, p) => sum + (p.payment_type === 'refund' ? -Number(p.amount_paid) : Number(p.amount_paid)),
                    0
                );

                if (netPaid > 0) {
                    return res.status(400).json({
                        message: `This fee already has Le ${netPaid.toFixed(2)} paid. Waivers cannot be applied to paid fees — use a refund instead.`
                    });
                }
            }

            /* Auto-approve if Proprietor or Administrator */
            const autoApprove = WAIVER_AUTO_APPROVE_ROLES.includes(roleId);
            const now = new Date().toISOString();
            const uid = userIdOf(req.user);

            const insertRow = {
                student_id: sid,
                student_fee_id: feeId,
                academic_year_id: yearId,
                waive_type,
                waive_amount: waiveAmt,
                reason: String(reason).trim(),
                status: autoApprove ? 'approved' : 'pending',
                requested_by: uid,
                requested_at: now,
                approved_by: autoApprove ? uid : null,
                approved_at: autoApprove ? now : null
            };

            const { data, error } = await supabase
                .from('student_fee_waivers')
                .insert(insertRow)
                .select()
                .single();

            if (error) throw error;

            res.status(201).json({
                message: autoApprove ? 'Waiver approved.' : 'Waiver submitted for approval.',
                waiver: data,
                needs_approval: !autoApprove
            });
        } catch (error) {
            console.error('POST /fees/waivers ERROR:', error);
            res.status(500).json({ message: 'Failed to create waiver.', error: error.message });
        }
    }
);

router.put(
    '/waivers/:waiverId/approve',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, WAIVER_APPROVE_ROLES)) {
                return res.status(403).json({ message: 'Only Proprietor or Administrator can approve waivers.' });
            }

            const waiverId = parseId(req.params.waiverId);
            if (!waiverId) return res.status(400).json({ message: 'Invalid waiver id.' });

            const { data: existing, error: exErr } = await supabase
                .from('student_fee_waivers')
                .select('status')
                .eq('waiver_id', waiverId)
                .maybeSingle();

            if (exErr) throw exErr;
            if (!existing) return res.status(404).json({ message: 'Waiver not found.' });
            if (existing.status !== 'pending') {
                return res.status(409).json({ message: `Waiver is already ${existing.status}.` });
            }

            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('student_fee_waivers')
                .update({
                    status: 'approved',
                    approved_by: userIdOf(req.user),
                    approved_at: now
                })
                .eq('waiver_id', waiverId)
                .select()
                .single();

            if (error) throw error;

            res.json({ message: 'Waiver approved.', waiver: data });
        } catch (error) {
            console.error('PUT /fees/waivers/:id/approve ERROR:', error);
            res.status(500).json({ message: 'Failed to approve waiver.', error: error.message });
        }
    }
);

router.put(
    '/waivers/:waiverId/reject',
    authenticateToken,
    async (req, res) => {
        try {
            if (!hasRole(req.user, WAIVER_APPROVE_ROLES)) {
                return res.status(403).json({ message: 'Only Proprietor or Administrator can reject waivers.' });
            }

            const waiverId = parseId(req.params.waiverId);
            if (!waiverId) return res.status(400).json({ message: 'Invalid waiver id.' });

            const reason = String(req.body?.rejection_reason || '').trim();
            if (!reason) return res.status(400).json({ message: 'rejection_reason is required.' });

            const { data: existing, error: exErr } = await supabase
                .from('student_fee_waivers')
                .select('status')
                .eq('waiver_id', waiverId)
                .maybeSingle();

            if (exErr) throw exErr;
            if (!existing) return res.status(404).json({ message: 'Waiver not found.' });
            if (existing.status !== 'pending') {
                return res.status(409).json({ message: `Waiver is already ${existing.status}.` });
            }

            const now = new Date().toISOString();

            const { data, error } = await supabase
                .from('student_fee_waivers')
                .update({
                    status: 'rejected',
                    rejected_by: userIdOf(req.user),
                    rejected_at: now,
                    rejection_reason: reason
                })
                .eq('waiver_id', waiverId)
                .select()
                .single();

            if (error) throw error;

            res.json({ message: 'Waiver rejected.', waiver: data });
        } catch (error) {
            console.error('PUT /fees/waivers/:id/reject ERROR:', error);
            res.status(500).json({ message: 'Failed to reject waiver.', error: error.message });
        }
    }
);

/* ============================================================
   BULK WAIVER — waive ALL outstanding fees for one student
   ============================================================ */

router.post('/waivers/bulk', authenticateToken, async (req, res) => {
    try {
        const roleId = getRoleId(req.user);
        if (!WAIVER_CREATE_ROLES.includes(roleId)) {
            return res.status(403).json({ message: 'You cannot create waivers.' });
        }

        const { student_id, reason, academic_year } = req.body || {};
        const sid = parseId(student_id);
        if (!sid) return res.status(400).json({ message: 'student_id is required.' });

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ message: 'reason is required.' });
        }

        const yearId = await resolveAcademicYearId(academic_year);
        if (!yearId) return res.status(400).json({ message: 'Could not determine academic year.' });

        /* All active fees for this student in this year */
        const { data: fees, error: feesErr } = await supabase
            .from('student_fees')
            .select('student_fee_id, amount_due')
            .eq('student_id', sid)
            .eq('academic_year_id', yearId);

        if (feesErr) throw feesErr;
        if (!fees || !fees.length) {
            return res.status(400).json({ message: 'No fees found for this student.' });
        }

        /* Exclude fees that already have approved payments */
        const feeIds = fees.map(f => f.student_fee_id);

        const { data: paidRows } = await supabase
            .from('payments')
            .select('student_fee_id')
            .in('student_fee_id', feeIds)
            .eq('approval_status', 'approved');

        const paidSet = new Set((paidRows || []).map(p => p.student_fee_id));

        /* Exclude fees that already have a pending or approved waiver */
        const { data: existingWaivers } = await supabase
            .from('student_fee_waivers')
            .select('student_fee_id, status')
            .in('student_fee_id', feeIds)
            .in('status', ['pending', 'approved']);

        const waivedSet = new Set((existingWaivers || []).map(w => w.student_fee_id));

        const eligible = fees.filter(
            f => !paidSet.has(f.student_fee_id) && !waivedSet.has(f.student_fee_id)
        );

        if (!eligible.length) {
            return res.status(400).json({
                message: 'No eligible fees to waive (all are already paid or already waived).'
            });
        }

        const autoApprove = WAIVER_AUTO_APPROVE_ROLES.includes(roleId);
        const now = new Date().toISOString();
        const uid = userIdOf(req.user);

        const rows = eligible.map(f => ({
            student_id: sid,
            student_fee_id: f.student_fee_id,
            academic_year_id: yearId,
            waive_type: 'full',
            waive_amount: null,
            reason: String(reason).trim(),
            status: autoApprove ? 'approved' : 'pending',
            requested_by: uid,
            requested_at: now,
            approved_by: autoApprove ? uid : null,
            approved_at: autoApprove ? now : null
        }));

        const { data: created, error } = await supabase
            .from('student_fee_waivers')
            .insert(rows)
            .select();

        if (error) throw error;

        res.status(201).json({
            message: autoApprove
                ? `Waived ${created.length} fee(s).`
                : `Submitted ${created.length} fee(s) for approval.`,
            waivers_created: created.length,
            skipped_paid: paidSet.size,
            skipped_waived: waivedSet.size,
            needs_approval: !autoApprove,
            data: created
        });

    } catch (error) {
        console.error('BULK WAIVER ERROR:', error);
        res.status(500).json({ message: 'Failed to create bulk waiver.', error: error.message });
    }
});

module.exports = router;