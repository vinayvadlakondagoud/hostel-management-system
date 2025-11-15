document.addEventListener("DOMContentLoaded", () => {
    loadUnassignedStudents();
    loadAvailableRooms();
    loadAssignments(); // Loads all assignments initially
    setupRoomFilterNavbar(); // New function to create the navbar

    document.getElementById("assign-btn").addEventListener("click", () => {
        console.log("➡ Assign button clicked");
        assignRoom();
    });
});

// Define all possible rooms for the navbar
const ALL_ROOMS = [
    '101', '102', '103', '104', '105',
    '201', '202', '203', '204', '205',
    '301', '302', '303', '304', '305',
    '401', '402', '403', '404', '405'
];

let currentFilterRoom = 'ALL'; // State to keep track of the current room filter

// ✅ Setup Room Filter Navbar (UPDATED to fetch and apply gender status)
async function setupRoomFilterNavbar() {
    const navbar = document.getElementById("room-filter-navbar");
    navbar.innerHTML = ''; // Clear previous buttons

    try {
        // 1. Fetch room gender status
        const genderStatusRes = await fetch("https://hostel-management-system-2-2x8y.onrender.com/all-rooms-gender-status");
        const genderStatus = await genderStatusRes.json();
        const roomStatusMap = new Map(genderStatus.map(status => [status.room_no, status.gender]));

        // 2. Create the "ALL" filter button
        createFilterButton('ALL', 'bg-blue-600 hover:bg-blue-700', 'ALL', navbar);

        // 3. Create buttons for each room
        ALL_ROOMS.forEach(room => {
            const gender = roomStatusMap.get(room) || 'EMPTY'; // Default to EMPTY
            let colorClass = 'bg-gray-200 hover:bg-gray-300'; // Default: Empty/Unknown

            if (gender === 'Male') {
                colorClass = 'bg-green-600 hover:bg-green-700';
            } else if (gender === 'Female') {
                colorClass = 'bg-pink-600 hover:bg-pink-700';
            }

            // Create and append button
            createFilterButton(room, colorClass, gender, navbar);
        });

        // Ensure 'ALL' button is selected initially
        document.querySelector(`#room-filter-navbar button[data-filter='ALL']`).classList.add('ring-4', 'ring-blue-300', 'ring-opacity-50');

    } catch (error) {
        console.error("❌ Error setting up room filter navbar:", error);
    }
}

// Helper function to create filter buttons
function createFilterButton(room, colorClass, gender, navbar) {
    const button = document.createElement("button");
    button.dataset.filter = room;
    button.className = `px-3 py-1 text-xs font-semibold text-white rounded-lg shadow transition duration-150 ease-in-out ${colorClass}`;
    button.textContent = room;
    button.title = `Filter by Room ${room} (${gender})`;
    button.addEventListener('click', () => {
        // Remove active state from all buttons
        document.querySelectorAll(`#room-filter-navbar button`).forEach(btn => {
            btn.classList.remove('ring-4', 'ring-blue-300', 'ring-opacity-50');
        });
        
        // Add active state to clicked button
        button.classList.add('ring-4', 'ring-blue-300', 'ring-opacity-50');

        currentFilterRoom = room;
        loadAssignments(room); // Load assignments for the selected room
    });
    navbar.appendChild(button);
}

// ✅ Load Unassigned Students
async function loadUnassignedStudents() {
    console.log("➡ Fetching unassigned students...");
    const studentSelect = document.getElementById("unassigned-student");
    studentSelect.innerHTML = '<option value="">Loading students...</option>';

    try {
        const response = await fetch("https://hostel-management-system-2-2x8y.onrender.com/unassigned-students");
        const students = await response.json();

        if (students.length === 0) {
            studentSelect.innerHTML = '<option value="" disabled>No unassigned students</option>';
            document.getElementById("assign-btn").disabled = true; // Disable assign button if no students
            return;
        }

        // Enable assign button
        document.getElementById("assign-btn").disabled = false;
        
        // Clear loading message
        studentSelect.innerHTML = ''; 
        // Add a default option
        studentSelect.innerHTML += '<option value="" selected disabled>Select a student</option>';

        students.forEach(student => {
            const option = document.createElement("option");
            option.value = student.username;
            option.textContent = `${student.name} (${student.username}) - ${student.gender}`;
            option.dataset.gender = student.gender;
            studentSelect.appendChild(option);
        });

        // Set up room filtering based on selected student's gender
        studentSelect.addEventListener('change', filterRoomsByGender);

    } catch (error) {
        console.error("❌ Error loading unassigned students:", error);
        studentSelect.innerHTML = '<option value="" disabled>Failed to load students</option>';
    }
}

// Helper function to filter rooms by gender on student selection
function filterRoomsByGender() {
    const studentSelect = document.getElementById("unassigned-student");
    const roomSelect = document.getElementById("room-select");
    const selectedOption = studentSelect.options[studentSelect.selectedIndex];
    const studentGender = selectedOption.dataset.gender;

    // Reset room select
    roomSelect.innerHTML = '<option value="" selected disabled>Select a room</option>';
    document.getElementById("room-select").disabled = false; // Enable room select again

    if (!studentGender) {
        // If no student is selected, just reload all rooms (unlikely given disabled option, but safe)
        loadRoomOptions(); 
        return;
    }

    // Load and filter rooms
    loadRoomOptions(studentGender); 
}

// ✅ Load all available room options for the dropdown
async function loadRoomOptions(studentGender = null) {
    const roomSelect = document.getElementById("room-select");
    
    // Disable temporarily
    roomSelect.innerHTML = '<option value="" selected disabled>Loading rooms...</option>';
    roomSelect.disabled = true;

    try {
        const response = await fetch("https://hostel-management-system-2-2x8y.onrender.com/available-rooms");
        let rooms = await response.json();
        
        // 1. Sort the rooms by room number (ascending)
        rooms.sort((a, b) => {
            const roomA = a.room_no;
            const roomB = b.room_no;

            // Simple string comparison works well for '101' through '405'
            if (roomA < roomB) return -1;
            if (roomA > roomB) return 1;
            return 0;
        });
        // ----------------------------------------------------

        // 2. Filter rooms by gender if a student is selected
        if (studentGender) {
            // Fetch room gender status to apply filtering
            const genderStatusRes = await fetch("https://hostel-management-system-2-2x8y.onrender.com/all-rooms-gender-status");
            const genderStatus = await genderStatusRes.json();
            const roomStatusMap = new Map(genderStatus.map(status => [status.room_no, status.gender]));

            rooms = rooms.filter(room => {
                const roomGender = roomStatusMap.get(room.room_no) || 'EMPTY';
                
                // Allow assignment if the room is empty OR the room's current gender matches the student's gender
                return roomGender === 'EMPTY' || roomGender === studentGender;
            });
        }
        
        // Clear loading message and enable select
        roomSelect.innerHTML = '';
        roomSelect.innerHTML += '<option value="" selected disabled>Select a room</option>';
        roomSelect.disabled = false;

        if (rooms.length === 0) {
            roomSelect.innerHTML = '<option value="" disabled>No compatible rooms available</option>';
            roomSelect.disabled = true;
            return;
        }

        rooms.forEach(room => {
            const option = document.createElement("option");
            option.value = room.room_no;
            option.textContent = `${room.room_no} (${room.available_beds} beds left)`;
            roomSelect.appendChild(option);
        });

    } catch (error) {
        console.error("❌ Error loading room options:", error);
        roomSelect.innerHTML = '<option value="" disabled>Failed to load rooms</option>';
    }
}


// ✅ Load Available Rooms (MODIFIED to sort rooms by number)
async function loadAvailableRooms() {
    console.log("➡ Fetching available rooms...");
    const availableRoomsList = document.getElementById("available-rooms-list");
    availableRoomsList.innerHTML = '<p class="text-center text-gray-500">Loading rooms...</p>';

    try {
        const response = await fetch("https://hostel-management-system-2-2x8y.onrender.com/available-rooms");
        const rooms = await response.json();

        // 1. Sort the rooms by room number (ascending)
        rooms.sort((a, b) => {
            const roomA = a.room_no;
            const roomB = b.room_no;

            // Simple string comparison works well for '101' through '405'
            if (roomA < roomB) return -1;
            if (roomA > roomB) return 1;
            return 0;
        });
        // ----------------------------------------------------

        if (rooms.length === 0) {
            availableRoomsList.innerHTML = '<p class="text-center text-gray-500">No rooms available.</p>';
            return;
        }

        availableRoomsList.innerHTML = ''; // Clear loading message

        rooms.forEach(room => {
            const roomDiv = document.createElement("div");
            roomDiv.className = "p-4 bg-white rounded-lg shadow-sm border border-gray-100 flex items-center justify-between transition duration-150 ease-in-out hover:bg-gray-50";
            roomDiv.innerHTML = `
                <div class="flex flex-col">
                    <span class="text-lg font-semibold text-gray-800">${room.room_no}</span>
                    <span class="text-sm text-gray-500">Available Beds: ${room.available_beds}</span>
                </div>
                <button
                    class="assign-room-btn text-blue-600 hover:text-blue-800 font-medium transition duration-150"
                    data-room="${room.room_no}"
                >
                    Assign
                </button>
            `;
            availableRoomsList.appendChild(roomDiv);
        });

        // Add event listeners to the new Assign buttons
        document.querySelectorAll(".assign-room-btn").forEach(button => {
            button.addEventListener("click", (e) => {
                const room = e.currentTarget.dataset.room;
                const studentSelect = document.getElementById("unassigned-student");
                
                // Set the room in the dropdown and disable it for a quick assignment flow
                document.getElementById("room-select").value = room;
                document.getElementById("room-select").disabled = true;

                // Scroll to the assignment form
                document.getElementById('assignment-form').scrollIntoView({ behavior: 'smooth' });

                // Highlight the assignment button to prompt the final action
                const assignBtn = document.getElementById("assign-btn");
                assignBtn.classList.add('animate-pulse', 'ring-4', 'ring-blue-300', 'ring-opacity-50');
                
                setTimeout(() => {
                    assignBtn.classList.remove('animate-pulse', 'ring-4', 'ring-blue-300', 'ring-opacity-50');
                }, 1500);

                console.log(`Room ${room} selected for assignment.`);
            });
        });

    } catch (error) {
        console.error("❌ Error loading available rooms:", error);
        availableRoomsList.innerHTML = '<p class="text-center text-red-500">Failed to load rooms.</p>';
    }
}


// ✅ Load Assignments (displays students who are in a room)
async function loadAssignments(roomFilter = 'ALL') {
    console.log(`➡ Fetching assignments for room: ${roomFilter}...`);
    const assignmentsTableBody = document.getElementById("assignments-table-body");
    assignmentsTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Loading assignments...</td></tr>';
    
    // Reset room select and form fields
    document.getElementById("assignment-form").reset();
    document.getElementById("room-select").disabled = false;


    try {
        const response = await fetch("https://hostel-management-system-2-2x8y.onrender.com/assignments");
        let assignments = await response.json();
        
        // Apply filter
        if (roomFilter !== 'ALL') {
            assignments = assignments.filter(assignment => assignment.room_no === roomFilter);
        }

        if (assignments.length === 0) {
            assignmentsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">No students assigned to ${roomFilter === 'ALL' ? 'rooms' : 'Room ' + roomFilter}.</td></tr>`;
            return;
        }

        assignmentsTableBody.innerHTML = ''; // Clear loading message

        assignments.forEach(assignment => {
            const row = document.createElement("tr");
            row.className = 'border-b hover:bg-gray-50 transition duration-100';
            row.innerHTML = `
                <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${assignment.name}</td>
                <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${assignment.username}</td>
                <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${assignment.gender === 'Male' ? 'bg-green-100 text-green-800' : 'bg-pink-100 text-pink-800'}">
                        ${assignment.gender}
                    </span>
                </td>
                <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${assignment.room_no}</td>
                <td class="px-6 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <button
                        class="remove-assignment-btn text-red-600 hover:text-red-900 transition duration-150"
                        data-username="${assignment.username}"
                    >
                        Remove
                    </button>
                </td>
            `;
            assignmentsTableBody.appendChild(row);
        });

        // Add event listeners to the new Remove buttons
        document.querySelectorAll(".remove-assignment-btn").forEach(button => {
            button.addEventListener("click", (e) => {
                const username = e.currentTarget.dataset.username;
                removeAssignment(username);
            });
        });

    } catch (error) {
        console.error("❌ Error loading assignments:", error);
        assignmentsTableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Failed to load assignments.</td></tr>';
    }
}


// ✅ Assign Room
function assignRoom() {
    const student = document.getElementById("unassigned-student").value;
    const room = document.getElementById("room-select").value;

    if (!student || !room) {
        alert("Please select both a student and a room.");
        return;
    }

    // Temporarily disable the button to prevent double-click
    const assignBtn = document.getElementById("assign-btn");
    assignBtn.disabled = true;
    assignBtn.textContent = 'Assigning...';

    fetch("https://hostel-management-system-2-2x8y.onrender.com/assign-room", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: student,
            room_no: room
        })
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(errorData => {
                throw new Error(errorData.message || "Failed to assign room due to server error.");
            });
        }
        return res.json();
    })
    .then(data => {
        alert(data.message);
        loadUnassignedStudents();
        loadAvailableRooms();
        loadAssignments(currentFilterRoom);
        // ⬅️ Refresh navbar to update gender status for the room just assigned
        setupRoomFilterNavbar(); 
    })
    .catch(error => {
        console.error("❌ Error assigning room:", error.message);
        alert(error.message);
    })
    .finally(() => {
        // Re-enable and reset the button
        assignBtn.disabled = false;
        assignBtn.textContent = 'Assign Room';
    });
}

// ✅ Remove assignment for a student (MODIFIED to refresh Navbar after removal)
function removeAssignment(username) {
    if (!confirm(`Are you sure you want to remove ${username}'s room assignment?`)) return;

    fetch(`https://hostel-management-system-2-2x8y.onrender.com/remove-assignment/${username}`, {
        method: "DELETE"
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        loadUnassignedStudents();
        loadAvailableRooms();
        loadAssignments(currentFilterRoom);
        // ⬅️ Refresh navbar to update gender status (will revert to 'EMPTY' if all students are removed)
        setupRoomFilterNavbar(); 
    })
    .catch(error => {
        console.error("❌ Error removing assignment:", error);
        alert("Failed to remove assignment.");
    });
}
