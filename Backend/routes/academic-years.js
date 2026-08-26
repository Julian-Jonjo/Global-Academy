const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET CURRENT ACADEMIC YEAR
// ============================================================
router.get(
    '/current',
    authenticateToken,
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .single();

            if (error) {
                return res.status(404).json({
                    message: 'No current academic year found'
                });
            }

            res.json(data);

        } catch (error) {
            console.error('Error loading current academic year:', error);
            res.status(500).json({
                message: 'Failed to load current academic year'
            });
        }
    }
);


// ============================================================
// GET ALL ACADEMIC YEARS
// ============================================================
router.get(
    '/',
    authenticateToken,
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('academic_years')
                .select('*')
                .order('start_date', { ascending: false });

            if (error) throw error;

            res.json(data);

        } catch (error) {
            console.error('Error loading academic years:', error);
            res.status(500).json({
                message: 'Failed to load academic years'
            });
        }
    }
);


// ============================================================
// CREATE ACADEMIC YEAR (Admin only)
// ============================================================
router.post(
    '/',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { year_name, start_date, end_date, is_current } = req.body;

            if (!year_name || !start_date || !end_date) {
                return res.status(400).json({
                    message: 'Year name, start date and end date are required'
                });
            }

            // If this is set as current, unset any existing current year
            if (is_current) {
                await supabase
                    .from('academic_years')
                    .update({ is_current: false })
                    .eq('is_current', true);
            }

            const { data, error } = await supabase
                .from('academic_years')
                .insert({
                    year_name,
                    start_date,
                    end_date,
                    is_current: is_current || false
                })
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({
                        message: 'Academic year with this name already exists'
                    });
                }
                throw error;
            }

            res.status(201).json({
                message: 'Academic year created successfully',
                academic_year: data
            });

        } catch (error) {
            console.error('Error creating academic year:', error);
            res.status(500).json({
                message: 'Failed to create academic year'
            });
        }
    }
);


// ============================================================
// UPDATE ACADEMIC YEAR (Admin only)
// ============================================================
router.put(
    '/:academicYearId',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const academicYearId = parseInt(req.params.academicYearId);
            const { year_name, start_date, end_date, is_current } = req.body;

            if (!year_name || !start_date || !end_date) {
                return res.status(400).json({
                    message: 'Year name, start date and end date are required'
                });
            }

            // If this is set as current, unset any existing current year
            if (is_current) {
                await supabase
                    .from('academic_years')
                    .update({ is_current: false })
                    .eq('is_current', true)
                    .neq('academic_year_id', academicYearId);
            }

            const { data, error } = await supabase
                .from('academic_years')
                .update({
                    year_name,
                    start_date,
                    end_date,
                    is_current: is_current || false,
                    updated_at: new Date().toISOString()
                })
                .eq('academic_year_id', academicYearId)
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({
                        message: 'Academic year with this name already exists'
                    });
                }
                throw error;
            }

            res.json({
                message: 'Academic year updated successfully',
                academic_year: data
            });

        } catch (error) {
            console.error('Error updating academic year:', error);
            res.status(500).json({
                message: 'Failed to update academic year'
            });
        }
    }
);


// ============================================================
// GET STUDENTS BY ACADEMIC YEAR
// ============================================================
router.get(
    '/:academicYearId/students',
    authenticateToken,
    async (req, res) => {
        try {
            const academicYearId = parseInt(req.params.academicYearId);

            const { data, error } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    class_id,
                    student_status,
                    classes:class_id (
                        class_name,
                        arm
                    )
                `)
                .eq('academic_year_id', academicYearId)
                .order('first_name');

            if (error) throw error;

            res.json(data);

        } catch (error) {
            console.error('Error loading students by academic year:', error);
            res.status(500).json({
                message: 'Failed to load students'
            });
        }
    }
);

module.exports = router;