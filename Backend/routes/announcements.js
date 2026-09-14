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

/*
   Manager may only manage announcements for their own sector.
   Proprietor and Administrator have no restriction.
*/
function managerCanManageSection(user, schoolSection) {
    if (getRoleId(user) !== MANAGER) {
        return false;
    }

    const userSector = normalizeSector(getSector(user));
    const targetSection = normalizeSector(schoolSection);

    if (userSector === 'primary') {
        return targetSection === 'nursery' ||
               targetSection === 'primary';
    }

    if (userSector === 'secondary') {
        return targetSection === 'jss' ||
               targetSection === 'sss' ||
               targetSection === 'secondary';
    }

    return false;
}


/* =========================================================
   GET ALL ANNOUNCEMENTS
   ========================================================= */

router.get(
    '/',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);

            let query = supabase
                .from('announcements')
                .select('*')
                .order('posted_at', { ascending: false });

            /*
               Manager only sees their own sector's announcements.
            */
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

                /*
                   Manager sees:
                     - global 'all' announcements
                     - announcements whose school_section matches
                       one of their allowed sections
                */
                query = query.or(
                    `audience.eq.all,school_section.in.(${allowedSections.join(',')})`
                );
            }

            const { data, error } = await query;

            if (error) throw error;

            return res.json(data || []);

        } catch (error) {

            console.error('GET ANNOUNCEMENTS ERROR:', error);

            return res.status(500).json({
                message: 'Failed to load announcements.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET SINGLE ANNOUNCEMENT
   ========================================================= */

router.get(
    '/:announcementId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .eq('announcement_id', req.params.announcementId)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                return res.status(404).json({
                    message: 'Announcement not found.'
                });
            }

            return res.json(data);

        } catch (error) {

            console.error('GET ANNOUNCEMENT ERROR:', error);

            return res.status(500).json({
                message: 'Failed to load announcement.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   CREATE ANNOUNCEMENT
   ========================================================= */

router.post(
    '/',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const body = req.body || {};

            const title = String(body.title || '').trim();
            const messageBody = String(body.body || '').trim();
            const audience = String(body.audience || '').trim().toLowerCase();

            if (!title || !messageBody || !audience) {
                return res.status(400).json({
                    message: 'Title, body, and audience are required.'
                });
            }

            const allowedAudiences = ['all', 'primary', 'secondary', 'class'];

            if (!allowedAudiences.includes(audience)) {
                return res.status(400).json({
                    message: 'Audience must be one of: all, primary, secondary, class.'
                });
            }

            let schoolSection = body.school_section || null;
            let classId = body.class_id || null;

            if (audience === 'primary') {
                schoolSection = 'Primary';
                classId = null;
            } else if (audience === 'secondary') {
                schoolSection = 'Secondary';
                classId = null;
            } else if (audience === 'all') {
                schoolSection = null;
                classId = null;
            } else if (audience === 'class') {
                if (!classId) {
                    return res.status(400).json({
                        message: 'class_id is required when audience is "class".'
                    });
                }
            }

            /*
               Manager may only create announcements for their sector.
               'all' audience is Proprietor/Administrator only.
            */
            if (roleId === MANAGER) {

                if (audience === 'all') {
                    return res.status(403).json({
                        message: 'Managers cannot post global announcements.'
                    });
                }

                if (audience === 'primary' || audience === 'secondary') {
                    const managerSector = normalizeSector(getSector(req.user));

                    if (managerSector !== audience) {
                        return res.status(403).json({
                            message: 'You can only post to your own sector.'
                        });
                    }
                }

                if (audience === 'class') {

                    const { data: classRow, error: classErr } = await supabase
                        .from('classes')
                        .select('class_id, school_section')
                        .eq('class_id', classId)
                        .maybeSingle();

                    if (classErr) throw classErr;

                    if (!classRow) {
                        return res.status(400).json({
                            message: 'Selected class was not found.'
                        });
                    }

                    if (!managerCanManageSection(req.user, classRow.school_section)) {
                        return res.status(403).json({
                            message: 'You cannot post to a class outside your sector.'
                        });
                    }

                    schoolSection = classRow.school_section;
                }
            }

                        /* recipient_type: 'student' | 'staff' | 'both' */
            const allowedRecipients = ['student', 'staff', 'both'];
            const recipientType = String(body.recipient_type || 'student')
                .trim()
                .toLowerCase();

            if (!allowedRecipients.includes(recipientType)) {
                return res.status(400).json({
                    message: 'recipient_type must be one of: student, staff, both.'
                });
            }

            /* Managers can only post to students, and only their sector. */
            if (roleId === MANAGER && recipientType !== 'student') {
                return res.status(403).json({
                    message: 'Managers can only post student notices.'
                });
            }

            const payload = {
                title,
                body: messageBody,
                audience,
                recipient_type: recipientType,
                school_section: schoolSection,
                class_id: classId,
                posted_by: req.user.user_id || null,
                is_active: body.is_active === false ? false : true,
                expires_at: body.expires_at || null
            };

            const { data, error } = await supabase
                .from('announcements')
                .insert(payload)
                .select()
                .single();

            if (error) throw error;

            return res.status(201).json({
                message: 'Announcement posted.',
                announcement: data
            });

        } catch (error) {

            console.error('CREATE ANNOUNCEMENT ERROR:', error);

            return res.status(500).json({
                message: 'Failed to create announcement.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   UPDATE ANNOUNCEMENT
   ========================================================= */

router.put(
    '/:announcementId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const announcementId = req.params.announcementId;

            const { data: existing, error: existingErr } = await supabase
                .from('announcements')
                .select('*')
                .eq('announcement_id', announcementId)
                .maybeSingle();

            if (existingErr) throw existingErr;

            if (!existing) {
                return res.status(404).json({
                    message: 'Announcement not found.'
                });
            }

            if (roleId === MANAGER) {
                if (existing.audience === 'all') {
                    return res.status(403).json({
                        message: 'Managers cannot edit global announcements.'
                    });
                }

                if (!managerCanManageSection(req.user, existing.school_section)) {
                    return res.status(403).json({
                        message: 'You cannot edit announcements outside your sector.'
                    });
                }
            }

                        const body = req.body || {};

            const update = {};

            if (typeof body.title === 'string') {
                update.title = body.title.trim();
            }
            if (typeof body.body === 'string') {
                update.body = body.body.trim();
            }
            if (typeof body.is_active === 'boolean') {
                update.is_active = body.is_active;
            }
            if (body.expires_at !== undefined) {
                update.expires_at = body.expires_at || null;
            }

            /* recipient_type is editable, with the same rules as create */
            if (body.recipient_type !== undefined) {
                const allowedRecipients = ['student', 'staff', 'both'];
                const recipientType = String(body.recipient_type || '')
                    .trim()
                    .toLowerCase();

                if (!allowedRecipients.includes(recipientType)) {
                    return res.status(400).json({
                        message: 'recipient_type must be one of: student, staff, both.'
                    });
                }

                if (roleId === MANAGER && recipientType !== 'student') {
                    return res.status(403).json({
                        message: 'Managers can only post student notices.'
                    });
                }

                update.recipient_type = recipientType;
            }

            const { data, error } = await supabase
                .from('announcements')
                .update(update)
                .eq('announcement_id', announcementId)
                .select()
                .single();

            if (error) throw error;

            return res.json({
                message: 'Announcement updated.',
                announcement: data
            });

        } catch (error) {

            console.error('UPDATE ANNOUNCEMENT ERROR:', error);

            return res.status(500).json({
                message: 'Failed to update announcement.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   DELETE ANNOUNCEMENT
   ========================================================= */

router.delete(
    '/:announcementId',
    authenticateToken,
    requireRoles(PROPRIETOR, ADMINISTRATOR, MANAGER),
    async (req, res) => {

        try {

            const roleId = getRoleId(req.user);
            const announcementId = req.params.announcementId;

            const { data: existing, error: existingErr } = await supabase
                .from('announcements')
                .select('*')
                .eq('announcement_id', announcementId)
                .maybeSingle();

            if (existingErr) throw existingErr;

            if (!existing) {
                return res.status(404).json({
                    message: 'Announcement not found.'
                });
            }

            if (roleId === MANAGER) {
                if (existing.audience === 'all') {
                    return res.status(403).json({
                        message: 'Managers cannot delete global announcements.'
                    });
                }

                if (!managerCanManageSection(req.user, existing.school_section)) {
                    return res.status(403).json({
                        message: 'You cannot delete announcements outside your sector.'
                    });
                }
            }

            const { error } = await supabase
                .from('announcements')
                .delete()
                .eq('announcement_id', announcementId);

            if (error) throw error;

            return res.json({
                message: 'Announcement deleted.'
            });

        } catch (error) {

            console.error('DELETE ANNOUNCEMENT ERROR:', error);

            return res.status(500).json({
                message: 'Failed to delete announcement.',
                error: error.message
            });
        }
    }
);


module.exports = router;