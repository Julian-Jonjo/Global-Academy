const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// GET ALL CLASSES (Role-filtered)
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('classes')
            .select('*')
            .eq('is_active', true)
            .order('school_section')
            .order('class_name')
            .order('arm');

        // Role-based filtering
        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }
        // Admin/Proprietor gets all

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading classes:', error);
        res.status(500).json({ message: 'Failed to load classes' });
    }
});

// ============================================================
// GET SINGLE CLASS
// ============================================================

router.get('/:classId', authenticateToken, async (req, res) => {
    try {
        const classId = Number(req.params.classId);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(classId)) {
            return res.status(400).json({ message: 'Invalid class ID' });
        }

        const { data, error } = await supabase
            .from('classes')
            .select('*')
            .eq('class_id', classId)
            .single();

        if (error || !data) {
            return res.status(404).json({ message: 'Class not found' });
        }

        // Check section access
        const classSection = (data.school_section || '').toLowerCase();

        if (isPrimaryManager(userRole)) {
            if (!['nursery', 'primary'].includes(classSection)) {
                return res.status(403).json({ message: 'Access denied to this class.' });
            }
        }

        if (isSecondaryManager(userRole)) {
            if (!['jss', 'sss', 'secondary'].includes(classSection)) {
                return res.status(403).json({ message: 'Access denied to this class.' });
            }
        }

        res.json(data);
    } catch (error) {
        console.error('Error loading class:', error);
        res.status(500).json({ message: 'Failed to load class' });
    }
});

// ============================================================
// CREATE CLASS (Admin only or Manager for their section)
// ============================================================

router.post('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { class_name, arm, school_section, academic_year_id } = req.body;

        if (!class_name || !school_section || !academic_year_id) {
            return res.status(400).json({ 
                message: 'Class name, school section and academic year are required' 
            });
        }

        // Enforce section access
        if (isPrimaryManager(userRole)) {
            if (!['Nursery', 'Primary'].includes(school_section)) {
                return res.status(403).json({ 
                    message: 'Manager-Primary can only create Nursery or Primary classes.' 
                });
            }
        }

        if (isSecondaryManager(userRole)) {
            if (!['JSS', 'SSS', 'Secondary'].includes(school_section)) {
                return res.status(403).json({ 
                    message: 'Manager-Secondary can only create JSS or SSS classes.' 
                });
            }
        }

        const { data, error } = await supabase
            .from('classes')
            .insert([{
                class_name,
                arm,
                school_section,
                academic_year_id,
                is_active: true
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            message: 'Class created successfully',
            class: data
        });
    } catch (error) {
        console.error('Error creating class:', error);
        res.status(500).json({ message: 'Failed to create class' });
    }
});

// ============================================================
// UPDATE CLASS
// ============================================================

router.put('/:classId', authenticateToken, async (req, res) => {
    try {
        const classId = Number(req.params.classId);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(classId)) {
            return res.status(400).json({ message: 'Invalid class ID' });
        }

        // Get existing class
        const { data: existingClass, error: fetchError } = await supabase
            .from('classes')
            .select('school_section')
            .eq('class_id', classId)
            .single();

        if (fetchError || !existingClass) {
            return res.status(404).json({ message: 'Class not found' });
        }

        const existingSection = existingClass.school_section;

        // Enforce section access
        if (isPrimaryManager(userRole)) {
            if (!['Nursery', 'Primary'].includes(existingSection)) {
                return res.status(403).json({ message: 'Access denied to update this class.' });
            }
        }

        if (isSecondaryManager(userRole)) {
            if (!['JSS', 'SSS', 'Secondary'].includes(existingSection)) {
                return res.status(403).json({ message: 'Access denied to update this class.' });
            }
        }

        const { data, error } = await supabase
            .from('classes')
            .update(req.body)
            .eq('class_id', classId)
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: 'Class updated successfully',
            class: data
        });
    } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).json({ message: 'Failed to update class' });
    }
});

// ============================================================
// DELETE CLASS
// ============================================================

router.delete('/:classId', authenticateToken, async (req, res) => {
    try {
        const classId = Number(req.params.classId);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(classId)) {
            return res.status(400).json({ message: 'Invalid class ID' });
        }

        // Get existing class
        const { data: existingClass, error: fetchError } = await supabase
            .from('classes')
            .select('school_section')
            .eq('class_id', classId)
            .single();

        if (fetchError || !existingClass) {
            return res.status(404).json({ message: 'Class not found' });
        }

        const existingSection = existingClass.school_section;

        // Enforce section access
        if (isPrimaryManager(userRole)) {
            if (!['Nursery', 'Primary'].includes(existingSection)) {
                return res.status(403).json({ message: 'Access denied to delete this class.' });
            }
        }

        if (isSecondaryManager(userRole)) {
            if (!['JSS', 'SSS', 'Secondary'].includes(existingSection)) {
                return res.status(403).json({ message: 'Access denied to delete this class.' });
            }
        }

        const { error } = await supabase
            .from('classes')
            .delete()
            .eq('class_id', classId);

        if (error) throw error;

        res.json({ message: 'Class deleted successfully' });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({ message: 'Failed to delete class' });
    }
});

module.exports = router;