/*
     /*
     * ==========================================
     * FORM ELEMENTS
     * ==========================================
     */

    const form =
        document.getElementById('studentForm');

    const message =
        document.getElementById('message');


    /*
     * ==========================================
     * LOAD CLASSES
     * ==========================================
     */

    async function loadClasses() {

        const classSelect =
            document.getElementById('class_id');


        try {

            const response = await fetch(
                '/api/classes',
                {
                    headers: {
                        'Authorization':
                            `Bearer ${token}`
                    }
                }
            );


            const classes =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    classes.message ||
                    'Failed to load classes.'
                );

            }


            classSelect.innerHTML =
                '<option value="">Select class</option>';


            classes.forEach(item => {

                const option =
                    document.createElement('option');


                option.value =
                    item.class_id;


                option.textContent =
                    `${item.class_name} — ${item.arm}`;


                classSelect.appendChild(option);

            });


        } catch (error) {

            console.error(
                'Failed to load classes:',
                error
            );


            classSelect.innerHTML =
                `
                <option value="">
                    Unable to load classes
                </option>
                `;

        }

    }


    /*
     * ==========================================
     * LOAD GUARDIANS
     * ==========================================
     */

    async function loadGuardians() {

        const guardianSelect =
            document.getElementById('guardian_id');


        try {

            const response = await fetch(
                '/api/guardians',
                {
                    headers: {
                        'Authorization':
                            `Bearer ${token}`
                    }
                }
            );


            const guardians =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    guardians.message ||
                    'Failed to load guardians.'
                );

            }


            guardianSelect.innerHTML =
                '<option value="">Select guardian</option>';


            guardians.forEach(item => {

                const option =
                    document.createElement('option');


                option.value =
                    item.guardian_id;


                option.textContent =
                    `${item.full_name} — ${
                        item.relationship ||
                        'Guardian'
                    }`;


                guardianSelect.appendChild(option);

            });


        } catch (error) {

            console.error(
                'Failed to load guardians:',
                error
            );


            guardianSelect.innerHTML =
                `
                <option value="">
                    Unable to load guardians
                </option>
                `;

        }

    }


    /*
     * Load database information
     * when the page opens.
     */

    function initializeStudentRegistration() {
    loadClasses();
    loadGuardians();

}


    /*
     * ==========================================
     * STUDENT REGISTRATION
     * ==========================================
     */

    form.addEventListener(
        'submit',
        async function(event) {

            event.preventDefault();


            /*
             * Show processing message
             */

            message.style.display =
                'block';

            message.className =
                'info';

            message.textContent =
                'Submitting registration...';


            /*
             * Collect student information
             */

            const student = {

                admission_number:
                    document.getElementById(
                        'admission_number'
                    ).value.trim(),


                first_name:
                    document.getElementById(
                        'first_name'
                    ).value.trim(),


                middle_name:
                    document.getElementById(
                        'middle_name'
                    ).value.trim(),


                last_name:
                    document.getElementById(
                        'last_name'
                    ).value.trim(),


                gender:
                    document.getElementById(
                        'gender'
                    ).value || null,


                date_of_birth:
                    document.getElementById(
                        'date_of_birth'
                    ).value || null,


                phone:
                    document.getElementById(
                        'phone'
                    ).value.trim(),


                address:
                    document.getElementById(
                        'address'
                    ).value.trim(),


                nationality:
                    document.getElementById(
                        'nationality'
                    ).value.trim(),


                previous_school:
                    document.getElementById(
                        'previous_school'
                    ).value.trim(),


                /*
                 * Class ID from dropdown
                 */

                class_id:
                    document.getElementById(
                        'class_id'
                    ).value || null,


                /*
                 * Guardian ID from dropdown
                 */

                guardian_id:
                    document.getElementById(
                        'guardian_id'
                    ).value || null,


                admission_date:
                    document.getElementById(
                        'admission_date'
                    ).value || null,


                emergency_contact_name:
                    document.getElementById(
                        'emergency_contact_name'
                    ).value.trim(),


                emergency_contact_phone:
                    document.getElementById(
                        'emergency_contact_phone'
                    ).value.trim(),


                emergency_contact_relationship:
                    document.getElementById(
                        'emergency_contact_relationship'
                    ).value.trim(),


                /*
                 * Approval workflow
                 */

                student_status:
                    'Pending'

            };


            /*
             * ==========================================
             * SEND TO SERVER
             * ==========================================
             */

            try {

                const response =
                    await fetch(
                        '/api/students',
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json',

                                'Authorization':
                                    `Bearer ${token}`
                            },

                            body:
                                JSON.stringify(student)
                        }
                    );


                const data =
                    await response.json();


                /*
                 * Server rejected request
                 */

                if (!response.ok) {

                    message.className =
                        'error';

                    message.textContent =
                        data.message ||
                        'Registration failed.';

                    console.error(
                        'Registration error:',
                        data
                    );

                    return;

                }


                /*
                 * Successful registration
                 */

                message.className =
                    'success';

                message.textContent =
                    'Student registration submitted successfully. ' +
                    'It is now pending approval.';


                /*
                 * Clear the form
                 */

                form.reset();


                /*
                 * Reload dropdowns because
                 * the form has been reset.
                 */

                await loadClasses();
                await loadGuardians();


            } catch (error) {

                console.error(
                    'Registration error:',
                    error
                );


                message.className =
                    'error';

                message.textContent =
                    'Unable to connect to the server.';

            }

        }
    );