const express = require('express');
const pool = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


/*
 * ==========================================
 * GET PENDING APPROVALS
 * ==========================================
 */

router.get(
    '/pending',
    authenticateToken,
    requireRoles(
        'Proprietor',
        'Administrator'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    ra.approval_id,
                    ra.record_type,
                    ra.record_id,
                    ra.approval_status,
                    ra.created_by,
                    ra.created_at,

                    u.username AS created_by_username,
                    u.full_name AS created_by_name,

                    s.admission_number,
                    s.first_name,
                    s.middle_name,
                    s.last_name,
                    s.gender,
                    s.date_of_birth,
                    s.phone,
                    s.address,
                    s.nationality,
                    s.previous_school,
                    s.admission_date,
                    s.emergency_contact_name,
                    s.emergency_contact_phone,
                    s.emergency_contact_relationship,

                    c.class_name,
                    c.arm,

                    g.full_name AS guardian_name,
                    g.relationship AS guardian_relationship,
                    g.phone AS guardian_phone,
                    g.email AS guardian_email,
                    g.address AS guardian_address

                FROM record_approvals ra

                LEFT JOIN users u
                    ON ra.created_by = u.user_id

                LEFT JOIN students s
                    ON ra.record_type = 'Student'
                    AND ra.record_id = s.student_id

                LEFT JOIN classes c
                    ON s.class_id = c.class_id

                LEFT JOIN guardians g
                    ON s.guardian_id = g.guardian_id

                WHERE ra.approval_status = 'Pending'

                ORDER BY ra.created_at ASC
            `);


            res.json(result.rows);


        } catch (error) {

            console.error(
                'Error loading pending approvals:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load pending approvals'
            });

        }

    }
);


/*
 * ==========================================
 * APPROVE RECORD
 * ==========================================
 */

router.post(
    '/:approvalId/approve',
    authenticateToken,
    requireRoles(
        'Proprietor',
        'Administrator'
    ),
    async (req, res) => {

        const approvalId =
            parseInt(req.params.approvalId);


        const approverId =
            req.user.user_id;


        const notes =
            req.body.notes || null;


        if (Number.isNaN(approvalId)) {

            return res.status(400).json({
                message:
                    'Invalid approval ID'
            });

        }


        try {

            await pool.query(
                `
                SELECT approve_record(
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    approvalId,
                    approverId,
                    notes
                ]
            );


            res.json({
                message:
                    'Record approved successfully',
                approval_id:
                    approvalId
            });


        } catch (error) {

            console.error(
                'Approval error:',
                error
            );


            res.status(400).json({
                message:
                    error.message
            });

        }

    }
);


/*
 * ==========================================
 * REJECT RECORD
 * ==========================================
 */

router.post(
    '/:approvalId/reject',
    authenticateToken,
    requireRoles(
        'Proprietor',
        'Administrator'
    ),
    async (req, res) => {

        const approvalId =
            parseInt(req.params.approvalId);


        const approverId =
            req.user.user_id;


        const reason =
            req.body.reason;


        if (Number.isNaN(approvalId)) {

            return res.status(400).json({
                message:
                    'Invalid approval ID'
            });

        }


        if (!reason || !reason.trim()) {

            return res.status(400).json({
                message:
                    'Rejection reason is required'
            });

        }


        try {

            /*
             * First verify that the approval
             * exists and is still pending.
             */

            const check =
                await pool.query(
                    `
                    SELECT
                        created_by,
                        approval_status
                    FROM record_approvals
                    WHERE approval_id = $1
                    `,
                    [approvalId]
                );


            if (check.rows.length === 0) {

                return res.status(404).json({
                    message:
                        'Approval record not found'
                });

            }


            const record =
                check.rows[0];


            if (
                record.approval_status !==
                'Pending'
            ) {

                return res.status(400).json({
                    message:
                        `This record is already ${record.approval_status}`
                });

            }


            /*
             * Prevent a user from rejecting
             * their own submission.
             */

            if (
                record.created_by ===
                approverId
            ) {

                return res.status(403).json({
                    message:
                        'A user cannot reject their own record'
                });

            }


            /*
             * Update approval record.
             */

            await pool.query(
                `
                UPDATE record_approvals

                SET
                    approval_status = 'Rejected',
                    approved_by = $1,
                    approved_at = CURRENT_TIMESTAMP,
                    rejection_reason = $2

                WHERE approval_id = $3
                `,
                [
                    approverId,
                    reason.trim(),
                    approvalId
                ]
            );


            res.json({
                message:
                    'Record rejected successfully',
                approval_id:
                    approvalId
            });


        } catch (error) {

            console.error(
                'Rejection error:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to reject record'
            });

        }

    }
);


module.exports = router;