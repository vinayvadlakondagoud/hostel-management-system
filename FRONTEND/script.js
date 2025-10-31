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
        const genderStatus = await genderStatusRes.json(); // e.g., { '101': 'Male', '202': 'Female' }
        console.debug("/all-rooms-gender-status ->", genderStatus);

        // If the primary endpoint returns an empty object, try a robust fallback:
        // build the mapping from /assignments (which has username+room_no) and /users (username->gender).
        let effectiveGenderStatus = genderStatus;
        if (!genderStatus || Object.keys(genderStatus).length === 0) {
            console.warn("/all-rooms-gender-status returned empty — trying fallback using /assignments + /users");
            try {
               const [assignRes, usersRes] = await Promise.all([
    fetch("https://hostel-management-system-2-2x8y.onrender.com/assignments"),
    fetch("https://hostel-management-system-2-2x8y.onrender.com/users")
]);

                const [assignments, users] = await Promise.all([assignRes.json(), usersRes.json()]);
                // Build username->gender map
                const userGender = users.reduce((acc, u) => { acc[u.username] = u.gender; return acc; }, {});
                // Build room->gender from first occupant
                effectiveGenderStatus = {};
                (assignments || []).forEach(a => {
                    if (!effectiveGenderStatus[a.room_no]) {
                        effectiveGenderStatus[a.room_no] = userGender[a.username] || 'EMPTY';
                    }
                });
                console.debug("Fallback effectiveGenderStatus ->", effectiveGenderStatus);
            } catch (fallbackErr) {
                console.error("Fallback failed:", fallbackErr);
                effectiveGenderStatus = {};
            }
        }

        // 2. "All" Button (Always active initially unless a specific room was already selected)
        const allBtn = createRoomFilterButton('ALL', 'ALL', currentFilterRoom === 'ALL');
        allBtn.onclick = () => filterAssignments('ALL');
        navbar.appendChild(allBtn);

        // 3. Individual Room Buttons
        ALL_ROOMS.forEach(room_no => {
            // Get the gender for this room from the fetched data, default to 'EMPTY'
            const roomGender = (effectiveGenderStatus && effectiveGenderStatus[room_no]) || 'EMPTY'; 
            
            const roomBtn = createRoomFilterButton(room_no, roomGender, currentFilterRoom === room_no);
            roomBtn.onclick = () => filterAssignments(room_no);
            navbar.appendChild(roomBtn);
        });

    } catch(error) {
        console.error("Failed to load room gender status:", error);
        // Fallback: create buttons without gender styling if API fails
        const allBtn = createRoomFilterButton('ALL', 'ALL', currentFilterRoom === 'ALL');
        allBtn.onclick = () => filterAssignments('ALL');
        navbar.appendChild(allBtn);
        ALL_ROOMS.forEach(room_no => {
            const roomBtn = createRoomFilterButton(room_no, 'EMPTY', currentFilterRoom === room_no);
            roomBtn.onclick = () => filterAssignments(room_no);
            navbar.appendChild(roomBtn);
        });
    }
}

// Helper to create a button element (UPDATED to apply gender classes)
function createRoomFilterButton(room_no, roomGender, isActive) {
    const button = document.createElement("button");
    button.id = `filter-btn-${room_no}`;
    
    let buttonText = room_no;
    
    // --- Define Styles ---
    const baseClass = "px-3 py-1 text-sm font-medium rounded-full transition-colors duration-200";
    const activeClass = "bg-purple-600 text-white shadow-lg";
    
    // Inactive/Gender-Specific Styles
    let dynamicClass = "bg-gray-200 text-gray-700 hover:bg-gray-300"; // Default for 'ALL' and EMPTY
    
    // Apply gender status and styling
    if (room_no === 'ALL') {
        buttonText = 'All Rooms';
    } else if (roomGender === 'Male') {
        buttonText = `${room_no} ♂️`;
        // Male: Light Blue background, Blue text, Blue border, Darker Blue hover
        dynamicClass = "bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200";
    } else if (roomGender === 'Female') {
        buttonText = `${room_no} ♀️`;
        // Female: Light Pink background, Pink text, Pink border, Darker Pink hover
        dynamicClass = "bg-pink-100 text-pink-700 border border-pink-200 hover:bg-pink-200";
    } else if (roomGender === 'EMPTY') {
        buttonText = room_no; // Empty room, use default grey
    }

    // Accessible label + title
    button.textContent = buttonText;
    button.title = room_no === 'ALL' ? 'Show assignments for all rooms' : `Filter assignments for room ${room_no} (${roomGender})`;
    button.setAttribute('aria-label', button.title);

    // Set classes: If active, use activeClass. Otherwise, use dynamicClass.
    button.className = `${baseClass} ${isActive ? activeClass : dynamicClass}`;
    button.setAttribute('data-room', room_no);
    // Store the gender to correctly re-apply the color when it is later un-selected
    button.setAttribute('data-gender', roomGender);

    // Keyboard support: Enter key activates the button
    button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            button.click();
        }
    });

    return button;
}

// ✅ Filter Assignments and update Navbar state (FIXED FOR CLASS RESET)
function filterAssignments(room_no) {
    const baseClass = "px-3 py-1 text-sm font-medium rounded-full transition-colors duration-200";
    const activeClass = "bg-purple-600 text-white shadow-lg";
    currentFilterRoom = room_no; // Set the new filter room

    // 1. Reset all buttons to their inactive/gender-specific default state
    document.querySelectorAll('#room-filter-navbar button').forEach(btn => {
        const currentGender = btn.getAttribute('data-gender');
        
        // --- Determine the correct inactive style based on the stored gender ---
        let inactiveClass;
        if (btn.getAttribute('data-room') === 'ALL') {
            inactiveClass = "bg-gray-200 text-gray-700 hover:bg-gray-300";
        } else if (currentGender === 'Male') {
            inactiveClass = "bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200";
        } else if (currentGender === 'Female') {
            inactiveClass = "bg-pink-100 text-pink-700 border border-pink-200 hover:bg-pink-200";
        } else {
            inactiveClass = "bg-gray-200 text-gray-700 hover:bg-gray-300"; // EMPTY rooms
        }

        // 💡 THE FIX: Completely overwrite the class name with only base and inactive styles.
        // This preserves the gender-based colors for inactive buttons.
        btn.className = `${baseClass} ${inactiveClass}`;
    });

    // 2. Set the new active button state (Always purple)
    const newActiveBtn = document.getElementById(`filter-btn-${room_no}`);
    if (newActiveBtn) {
        // 💡 THE FIX: Completely overwrite the class name with only base and active styles.
        newActiveBtn.className = `${baseClass} ${activeClass}`;
    }

    // Update the title
    const titleElement = document.getElementById("assignments-title");
    titleElement.textContent = room_no === 'ALL'
        ? 'Current Room Assignments (All Rooms)'
        : `Assignments for Room ${room_no}`;
    
    // Reload assignments with the new filter
    loadAssignments(room_no);
}


// 📝 NOTE: loadAssignments is updated to accept an optional filter
// ✅ Load current assignments with delete option
function loadAssignments(filterRoom = currentFilterRoom) {
    let url = "https://hostel-management-system-2-2x8y.onrender.com/assignments";

    // If a room is specified (and it's not 'ALL'), use the filtered API endpoint
    if (filterRoom && filterRoom !== 'ALL') {
        url = `https://hostel-management-system-2-2x8y.onrender.com/assignments/${filterRoom}`;
    }

    fetch(url)
        .then(res => {
            if (!res.ok) {
                return res.json().then(error => {
                    if (error.message === 'No assignments found' || error.message === 'No assignments for this room') {
                         return []; // Return empty array to proceed to render an empty list
                    }
                    throw new Error(error.message || 'Network response was not ok');
                });
            }
            return res.json();
        })
        .then(data => {
            const list = document.getElementById("assignments-list");
            list.innerHTML = "";

            if (data.length === 0) {
                const roomText = filterRoom && filterRoom !== 'ALL' ? `for Room ${filterRoom}` : '';
                list.innerHTML = `<p class="text-gray-500">No assignments ${roomText} yet.</p>`;
                return;
            }

            data.forEach(item => {
                const div = document.createElement("div");
                div.className = "p-3 bg-gray-50 border rounded-lg shadow-sm flex justify-between items-center";
                div.innerHTML = `
                    <p><strong>${item.username}</strong> → Room
                    <span class="text-purple-600 font-semibold">${item.room_no}</span>
                    (Bed ${item.bed_no})</p>
                    <button class="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                        onclick="removeAssignment('${item.username}')">Remove</button>
                `;
                list.appendChild(div);
            });
        })
        .catch(err => console.error("❌ Error fetching assignments:", err));
}


// ✅ Load unassigned students (No change)
function loadUnassignedStudents() {
    fetch("https://hostel-management-system-2-2x8y.onrender.com/unassigned-users")
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("student-list");
            const select = document.getElementById("select-student");
            list.innerHTML = "";
            select.innerHTML = `<option value="" disabled selected>-- Choose a student --</option>`;

            if (data.length === 0) {
                list.innerHTML = `<p class="text-gray-500">All students are assigned.</p>`;
                return;
            }

            data.forEach(student => {
                const div = document.createElement("div");
                div.className = "p-3 bg-white border rounded-lg shadow-sm";
                div.innerHTML = `<strong>${student.username}</strong> (${student.gender})`;
                list.appendChild(div);

                const option = document.createElement("option");
                option.value = student.username;
                option.textContent = student.username;
                select.appendChild(option);
            });
        })
        .catch(err => console.error("❌ Error fetching unassigned students:", err));
}

// ✅ Load available rooms with available beds (No change)
function loadAvailableRooms() {
    fetch("https://hostel-management-system-2-2x8y.onrender.com/available-rooms")
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("room-list");
            const select = document.getElementById("select-room");
            list.innerHTML = "";
            select.innerHTML = `<option value="" disabled selected>-- Choose a room --</option>`;

            if (data.length === 0) {
                list.innerHTML = `<p class="text-gray-500">No available rooms.</p>`;
                return;
            }

            data.forEach(room => {
                // room = { room_no: "101", available_beds: 2 }
                const div = document.createElement("div");
                div.className = "p-3 bg-white border rounded-lg shadow-sm";
                div.innerHTML = `Room <strong>${room.room_no}</strong> — <span class="text-green-600 font-semibold">${room.available_beds} bed(s) available</span>`;
                list.appendChild(div);

                const option = document.createElement("option");
                option.value = room.room_no;
                option.textContent = `Room ${room.room_no} (${room.available_beds} bed${room.available_beds > 1 ? "s" : ""} available)`;
                select.appendChild(option);
            });
        })
        .catch(err => console.error("❌ Error fetching available rooms:", err));
}

// ✅ Assign Room (MODIFIED to refresh Navbar after assignment)
function assignRoom() {
    const student = document.getElementById("select-student").value;
    const room = document.getElementById("select-room").value;

    if (!student || !room) {
        alert("⚠ Please select both student and room!");
        return;
    }

    fetch("https://hostel-management-system-2-2x8y.onrender.com/assign-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        // ⬅️ Refresh navbar to update gender status (will revert to 'EMPTY' if all students leave the room)
        setupRoomFilterNavbar(); 
    })
    .catch(err => console.error("❌ Error removing assignment:", err));
}
