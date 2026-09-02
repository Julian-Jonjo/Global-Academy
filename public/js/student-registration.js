<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Global Education Academy | Student Registration</title>

    <style>
        /* =========================================================
           GLOBAL
        ========================================================= */
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f0f2f5;
            color: #222;
            min-height: 100vh;
            background-image: url('/images/school-bg.jpg');
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-repeat: no-repeat;
            position: relative;
        }

        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background: rgba(255, 255, 255, 0.85);
            z-index: 0;
        }

        /* =========================================================
           HEADER
        ========================================================= */
        .header {
            background: #1a3c6e;
            color: white;
            padding: 12px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .header-logo {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            overflow: hidden;
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .header-logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            padding: 4px;
        }

        .header-title h1 {
            margin: 0;
            font-size: 18px;
            font-weight: 700;
            color: white;
        }

        .header-title p {
            margin: 0;
            font-size: 11px;
            color: #a0c4ff;
        }

        .user-info {
            text-align: right;
            font-size: 13px;
            color: white;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 4px;
        }

        .user-info .role {
            display: block;
            font-weight: 600;
            font-size: 14px;
        }

        .user-info .role-label {
            font-size: 11px;
            color: #a0c4ff;
        }

        /* =========================================================
           CONTAINER
        ========================================================= */
        .container {
            max-width: 900px;
            margin: 30px auto;
            padding: 0 20px 40px;
            position: relative;
            z-index: 1;
        }

        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .page-header h2 {
            margin: 0;
            color: #1f2937;
            font-size: 24px;
        }

        .page-header p {
            margin: 0;
            color: #6b7280;
            font-size: 14px;
        }

        .back-btn {
            background: #6b7280;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 10px 18px;
            cursor: pointer;
            font-weight: bold;
            text-decoration: none;
            display: inline-block;
            transition: all 0.3s;
            font-size: 13px;
        }

        .back-btn:hover {
            background: #4b5563;
            transform: translateY(-2px);
        }

        /* =========================================================
           FORM
        ========================================================= */
        .form-card {
            background: white;
            border-radius: 12px;
            padding: 30px 35px;
            box-shadow: 0 3px 15px rgba(0, 0, 0, 0.08);
        }

        .form-section {
            margin-bottom: 25px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e5e7eb;
        }

        .form-section:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }

        .form-section h3 {
            font-size: 16px;
            color: #1f2937;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .form-section h3 .section-icon {
            font-size: 20px;
        }

        .form-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }

        .form-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .form-field.full {
            grid-column: 1 / -1;
        }

        .form-field label {
            font-size: 12px;
            font-weight: 600;
            color: #4b5563;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .form-field label .required {
            color: #dc2626;
        }

        .form-field input,
        .form-field select,
        .form-field textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
            background: #f9fafb;
            transition: all 0.3s;
        }

        .form-field input:focus,
        .form-field select:focus,
        .form-field textarea:focus {
            outline: none;
            border-color: #1a3c6e;
            box-shadow: 0 0 0 3px rgba(26, 60, 110, 0.1);
            background: white;
        }

        .form-field textarea {
            min-height: 80px;
            resize: vertical;
        }

        .form-field .hint {
            font-size: 11px;
            color: #6b7280;
            margin-top: 2px;
        }

        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }

        .btn {
            border: none;
            padding: 12px 28px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            transition: all 0.3s;
        }

        .btn:hover {
            transform: translateY(-2px);
        }

        .btn-primary {
            background: #1a3c6e;
            color: white;
        }

        .btn-primary:hover {
            background: #0f2a4a;
            box-shadow: 0 4px 15px rgba(26, 60, 110, 0.3);
        }

        .btn-secondary {
            background: #6b7280;
            color: white;
        }

        .btn-secondary:hover {
            background: #4b5563;
        }

        /* =========================================================
           MESSAGES
        ========================================================= */
        #message {
            display: none;
            padding: 14px 18px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
        }

        #message.success {
            display: block;
            background: #dcfce7;
            color: #166534;
            border: 1px solid #86efac;
        }

        #message.error {
            display: block;
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        #message.info {
            display: block;
            background: #dbeafe;
            color: #1e40af;
            border: 1px solid #93c5fd;
        }

        /* =========================================================
           RESPONSIVE
        ========================================================= */
        @media (max-width: 700px) {
            .header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
                padding: 12px 20px;
            }

            .user-info {
                text-align: left;
                align-items: flex-start;
            }

            .form-grid {
                grid-template-columns: 1fr;
            }

            .form-card {
                padding: 20px;
            }

            .page-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }

            .form-actions {
                flex-direction: column;
            }

            .form-actions .btn {
                width: 100%;
            }

            .header-title h1 {
                font-size: 15px;
            }

            .header-logo {
                width: 32px;
                height: 32px;
            }
        }

        @media (max-width: 480px) {
            .container {
                padding: 0 12px 20px;
            }

            .form-card {
                padding: 16px;
            }

            .form-field input,
            .form-field select,
            .form-field textarea {
                font-size: 13px;
                padding: 8px 10px;
            }
        }
    </style>
</head>

<body>

    <!-- =========================================================
         HEADER
    ========================================================= -->
    <header class="header">
        <div class="header-left">
            <div class="header-logo">
                <img src="/images/logo.png" alt="Global Education Academy" onerror="this.style.display='none'; this.parentElement.textContent='🏫';">
            </div>
            <div class="header-title">
                <h1>GLOBAL EDUCATION ACADEMY</h1>
                <p>Student Registration</p>
            </div>
        </div>
        <div class="user-info">
            <span class="role" id="userRole"></span>
            <span class="role-label" id="userRoleLabel"></span>
        </div>
    </header>

    <!-- =========================================================
         MAIN CONTENT
    ========================================================= -->
    <main class="container">

        <div class="page-header">
            <div>
                <h2>📝 Register New Student</h2>
                <p>Fill in the student details below to register.</p>
            </div>
            <button class="back-btn" onclick="goBack()">← Back</button>
        </div>

        <div id="message"></div>

        <form id="studentForm" class="form-card">
            <!-- ==================================================
                 PERSONAL INFORMATION
            ================================================== -->
            <div class="form-section">
                <h3><span class="section-icon">👤</span> Personal Information</h3>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Admission Number <span class="required">*</span></label>
                        <input type="text" id="admission_number" placeholder="e.g., GA-2026-0001" required>
                    </div>

                    <div class="form-field">
                        <label>Gender <span class="required">*</span></label>
                        <select id="gender" required>
                            <option value="">Select gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>

                    <div class="form-field">
                        <label>First Name <span class="required">*</span></label>
                        <input type="text" id="first_name" placeholder="First name" required>
                    </div>

                    <div class="form-field">
                        <label>Middle Name</label>
                        <input type="text" id="middle_name" placeholder="Middle name">
                    </div>

                    <div class="form-field">
                        <label>Last Name <span class="required">*</span></label>
                        <input type="text" id="last_name" placeholder="Last name" required>
                    </div>

                    <div class="form-field">
                        <label>Date of Birth</label>
                        <input type="date" id="date_of_birth">
                    </div>

                    <div class="form-field">
                        <label>Nationality</label>
                        <input type="text" id="nationality" placeholder="e.g., Sierra Leonean" value="Sierra Leonean">
                    </div>

                    <div class="form-field">
                        <label>Phone</label>
                        <input type="text" id="phone" placeholder="Phone number">
                    </div>

                    <div class="form-field full">
                        <label>Address</label>
                        <textarea id="address" placeholder="Home address"></textarea>
                    </div>
                </div>
            </div>

            <!-- ==================================================
                 SCHOOL INFORMATION
            ================================================== -->
            <div class="form-section">
                <h3><span class="section-icon">🏫</span> School Information</h3>
                <div class="form-grid">
                    <div class="form-field full">
                        <label>Class <span class="required">*</span></label>
                        <select id="class_id" required>
                            <option value="">Select class</option>
                        </select>
                    </div>

                    <div class="form-field">
                        <label>Admission Date</label>
                        <input type="date" id="admission_date">
                    </div>

                    <div class="form-field">
                        <label>Previous School</label>
                        <input type="text" id="previous_school" placeholder="Previous school attended">
                    </div>
                </div>
            </div>

            <!-- ==================================================
                 GUARDIAN INFORMATION
            ================================================== -->
            <div class="form-section">
                <h3><span class="section-icon">👨‍👩‍👧</span> Guardian Information</h3>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Guardian Name <span class="required">*</span></label>
                        <input type="text" id="guardian_name" placeholder="Full name" required>
                    </div>

                    <div class="form-field">
                        <label>Relationship <span class="required">*</span></label>
                        <select id="guardian_relationship" required>
                            <option value="">Select relationship</option>
                            <option value="Father">Father</option>
                            <option value="Mother">Mother</option>
                            <option value="Guardian">Guardian</option>
                            <option value="Uncle">Uncle</option>
                            <option value="Aunt">Aunt</option>
                            <option value="Grandparent">Grandparent</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>

                    <div class="form-field">
                        <label>Guardian Phone</label>
                        <input type="text" id="guardian_phone" placeholder="Phone number">
                    </div>

                    <div class="form-field">
                        <label>Guardian Email</label>
                        <input type="email" id="guardian_email" placeholder="Email address">
                    </div>

                    <div class="form-field full">
                        <label>Guardian Address</label>
                        <textarea id="guardian_address" placeholder="Guardian's address"></textarea>
                    </div>
                </div>
            </div>

            <!-- ==================================================
                 EMERGENCY CONTACT
            ================================================== -->
            <div class="form-section">
                <h3><span class="section-icon">🚨</span> Emergency Contact</h3>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Contact Name</label>
                        <input type="text" id="emergency_contact_name" placeholder="Full name">
                    </div>

                    <div class="form-field">
                        <label>Contact Phone</label>
                        <input type="text" id="emergency_contact_phone" placeholder="Phone number">
                    </div>

                    <div class="form-field full">
                        <label>Relationship</label>
                        <input type="text" id="emergency_contact_relationship" placeholder="e.g., Brother, Aunt, Neighbor">
                    </div>
                </div>
            </div>

            <!-- ==================================================
                 FORM ACTIONS
            ================================================== -->
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="resetForm()">Reset</button>
                <button type="submit" class="btn btn-primary">Submit Registration</button>
            </div>
        </form>

    </main>

    <script>
        // =========================================================
        // AUTHENTICATION
        // =========================================================

        const token = sessionStorage.getItem('authToken');
        const userData = sessionStorage.getItem('user');

        if (!token || !userData) {
            window.location.href = '/login.html';
        }

        let user;
        try {
            user = JSON.parse(userData);
        } catch (error) {
            sessionStorage.removeItem('authToken');
            sessionStorage.removeItem('user');
            window.location.href = '/login.html';
        }

        const role = user.role_name || user.role || '';
        const userRole = (user.role_name || user.role || '').toLowerCase();

        // =========================================================
        // DISPLAY USER INFO
        // =========================================================

        document.getElementById('userRole').textContent = role || 'User';
        document.getElementById('userRoleLabel').textContent = 'Student Registration';

        // =========================================================
        // BACK BUTTON - Go to appropriate sector
        // =========================================================

        function goBack() {
            // Determine which sector the user belongs to
            const isPrimaryManager = userRole.includes('manager-primary') || role === 'Manager-Primary';
            const isSecondaryManager = userRole.includes('manager-secondary') || role === 'Manager-Secondary';
            const isPrimaryFinance = userRole.includes('finance officer (primary)') || role === 'Finance Officer (Primary)';
            const isSecondaryFinance = userRole.includes('finance officer (secondary)') || role === 'Finance Officer (Secondary)';
            const isAdmin = userRole.includes('admin') || userRole.includes('administrator') || role === 'Administrator' || role === 'Admin';
            const isProprietor = userRole.includes('proprietor') || role === 'Proprietor';

            // Check if user has sector-specific access
            if (isPrimaryManager || isPrimaryFinance) {
                window.location.href = 'primary-students.html';
            } else if (isSecondaryManager || isSecondaryFinance) {
                window.location.href = 'secondary-students.html';
            } else if (isAdmin || isProprietor) {
                // Admin/Proprietor can see both - go to students management dashboard
                window.location.href = 'students.html';
            } else {
                // Default fallback
                window.location.href = 'dashboard.html';
            }
        }

        // =========================================================
        // LOAD CLASSES
        // =========================================================

        async function loadClasses() {
            const classSelect = document.getElementById('class_id');

            try {
                const response = await fetch('/api/classes', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const classes = await response.json();

                if (!response.ok) {
                    throw new Error(classes.message || 'Failed to load classes.');
                }

                classSelect.innerHTML = '<option value="">Select class</option>';

                // Filter classes based on user role
                let filteredClasses = classes || [];

                if (isPrimaryManager || isPrimaryFinance) {
                    filteredClasses = filteredClasses.filter(c =>
                        ['Nursery', 'Primary'].includes(c.school_section)
                    );
                } else if (isSecondaryManager || isSecondaryFinance) {
                    filteredClasses = filteredClasses.filter(c =>
                        ['JSS', 'SSS', 'Secondary'].includes(c.school_section)
                    );
                }

                filteredClasses.forEach(item => {
                    const option = document.createElement('option');
                    option.value = item.class_id;
                    option.textContent = `${item.class_name}${item.arm ? ` — ${item.arm}` : ''}`;
                    classSelect.appendChild(option);
                });

            } catch (error) {
                console.error('Failed to load classes:', error);
                classSelect.innerHTML = `<option value="">Unable to load classes</option>`;
            }
        }

        // =========================================================
        // FORM SUBMISSION
        // =========================================================

        const form = document.getElementById('studentForm');
        const message = document.getElementById('message');

        const isPrimaryManager = userRole.includes('manager-primary') || role === 'Manager-Primary';
        const isSecondaryManager = userRole.includes('manager-secondary') || role === 'Manager-Secondary';
        const isPrimaryFinance = userRole.includes('finance officer (primary)') || role === 'Finance Officer (Primary)';
        const isSecondaryFinance = userRole.includes('finance officer (secondary)') || role === 'Finance Officer (Secondary)';

        form.addEventListener('submit', async function(event) {
            event.preventDefault();

            message.style.display = 'block';
            message.className = 'info';
            message.textContent = 'Submitting registration...';

            // Collect form data
            const getValue = (id) => {
                const el = document.getElementById(id);
                return el ? el.value.trim() : '';
            };
            const getSelectValue = (id) => {
                const el = document.getElementById(id);
                return el ? el.value : '';
            };

            const student = {
                admission_number: getValue('admission_number'),
                first_name: getValue('first_name'),
                middle_name: getValue('middle_name'),
                last_name: getValue('last_name'),
                gender: getSelectValue('gender') || null,
                date_of_birth: getValue('date_of_birth') || null,
                phone: getValue('phone'),
                address: getValue('address'),
                nationality: getValue('nationality') || 'Sierra Leonean',
                previous_school: getValue('previous_school'),
                class_id: getSelectValue('class_id') || null,
                guardian_name: getValue('guardian_name'),
                guardian_relationship: getSelectValue('guardian_relationship'),
                guardian_phone: getValue('guardian_phone'),
                guardian_email: getValue('guardian_email'),
                guardian_address: getValue('guardian_address'),
                admission_date: getValue('admission_date') || null,
                emergency_contact_name: getValue('emergency_contact_name'),
                emergency_contact_phone: getValue('emergency_contact_phone'),
                emergency_contact_relationship: getValue('emergency_contact_relationship'),
                student_status: 'Pending'
            };

            // Validate required fields
            if (!student.admission_number || !student.first_name || !student.last_name || !student.class_id) {
                message.className = 'error';
                message.textContent = 'Please fill in all required fields: Admission Number, First Name, Last Name, and Class.';
                return;
            }

            if (!student.guardian_name || !student.guardian_relationship) {
                message.className = 'error';
                message.textContent = 'Please fill in Guardian Name and Relationship.';
                return;
            }

            try {
                const response = await fetch('/api/students', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(student)
                });

                const data = await response.json();

                if (!response.ok) {
                    message.className = 'error';
                    message.textContent = data.message || 'Registration failed.';
                    console.error('Registration error:', data);
                    return;
                }

                message.className = 'success';
                message.textContent = '✅ Student registered successfully! It is now pending approval.';

                // Reset form
                form.reset();

                // Reload classes
                await loadClasses();

            } catch (error) {
                console.error('Registration error:', error);
                message.className = 'error';
                message.textContent = 'Unable to connect to the server. Please try again.';
            }
        });

        // =========================================================
        // RESET FORM
        // =========================================================

        function resetForm() {
            if (confirm('Are you sure you want to clear all fields?')) {
                form.reset();
                message.style.display = 'none';
            }
        }

        // =========================================================
        // INITIALIZE
        // =========================================================

        loadClasses();
    </script>

</body>

</html>