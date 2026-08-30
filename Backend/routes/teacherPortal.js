// middleware/authMiddleware.js

const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

const requireTeacher = (req, res, next) => {
    if (req.user.role_name !== 'Teacher') {
        return res.status(403).json({ message: 'Teacher access required' });
    }
    next();
};

const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const userRole = req.user.role_name || '';
        
        const hasAccess = allowedRoles.some(role => 
            userRole.toLowerCase() === role.toLowerCase()
        );

        if (!hasAccess) {
            return res.status(403).json({ 
                message: 'Access denied. Insufficient permissions.' 
            });
        }

        next();
    };
};

// NEW: Middleware to check section access
const requireSection = (section) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const userRole = (req.user.role_name || '').toLowerCase();

        // Admin and Proprietor can access both sections
        if (userRole === 'administrator' || userRole === 'proprietor') {
            return next();
        }

        // Primary Manager can only access Primary
        if (section === 'Primary' && userRole.includes('primary')) {
            return next();
        }

        // Secondary Manager can only access Secondary
        if (section === 'Secondary' && userRole.includes('secondary')) {
            return next();
        }

        return res.status(403).json({ 
            message: `Access denied. You do not have permission to access ${section} School data.` 
        });
    };
};

module.exports = { 
    authenticateToken, 
    requireTeacher, 
    requireRoles,
    requireSection 
};