import { AppData, Contact } from '@shared/ipc';

const DUMMY_CONTACTS: Contact[] = [
    {
        name: "Sarah Connors",
        email: "sarah.connors@example.com",
        phone: "+1 (555) 123-4567",
        title: "Senior Director",
        _searchString: "sarah connors senior director",
        raw: {}
    },
    {
        name: "John Smith",
        email: "john.smith@example.com",
        phone: "+1 (555) 987-6543",
        title: "Product Manager",
        _searchString: "john smith product manager",
        raw: {}
    },
    {
        name: "Emily Davis",
        email: "emily.davis@example.com",
        phone: "+1 (555) 456-7890",
        title: "Developer",
        _searchString: "emily davis developer",
        raw: {}
    },
    {
        name: "Michael Brown",
        email: "michael.brown@example.com",
        phone: "+1 (555) 789-0123",
        title: "Designer",
        _searchString: "michael brown designer",
        raw: {}
    },
    {
        name: "Information Technology",
        email: "it.support@example.com",
        phone: "+1 (800) 555-0000",
        title: "Department",
        _searchString: "information technology department",
        raw: {}
    },
    {
        name: "Executive Team",
        email: "execs@example.com",
        phone: "",
        title: "Distribution List",
        _searchString: "executive team distribution list",
        raw: {}
    },
    {
        name: "Operations Central",
        email: "ops@example.com",
        phone: "+1 (555) 222-3333",
        title: "Ops Center",
        _searchString: "operations central ops center",
        raw: {}
    },
    {
        name: "Legal Department",
        email: "legal@example.com",
        phone: "+1 (555) 444-5555",
        title: "Legal",
        _searchString: "legal department",
        raw: {}
    },
    {
        name: "Dr. Alice Vance",
        email: "alice.vance@research.labs",
        phone: "+1 (555) 333-7777",
        title: "Lead Scientist",
        _searchString: "dr alice vance lead scientist",
        raw: {}
    },
    {
        name: "Barney Calhoun",
        email: "b.calhoun@security.mesa",
        phone: "+1 (555) 222-8888",
        title: "Security Officer",
        _searchString: "barney calhoun security officer",
        raw: {}
    },
    {
        name: "Gordon Freeman",
        email: "g.freeman@anomalous.materials",
        phone: "",
        title: "Research Associate",
        _searchString: "gordon freeman research associate",
        raw: {}
    }
];

export const DUMMY_DATA: AppData = {
    groups: {
        "Executive Leadership": [
            "sarah.connors@example.com",
            "john.smith@example.com"
        ],
        "Product Team": [
            "john.smith@example.com",
            "emily.davis@example.com",
            "michael.brown@example.com"
        ],
        "Engineering": [
            "emily.davis@example.com",
            "it.support@example.com",
            "alice.vance@research.labs",
            "g.freeman@anomalous.materials"
        ],
        "Design": [
            "michael.brown@example.com"
        ],
        "Security": [
            "b.calhoun@security.mesa"
        ],
        "All Hands": [
            "sarah.connors@example.com",
            "john.smith@example.com",
            "emily.davis@example.com",
            "michael.brown@example.com",
            "it.support@example.com",
            "execs@example.com",
            "ops@example.com",
            "legal@example.com",
            "alice.vance@research.labs",
            "b.calhoun@security.mesa",
            "g.freeman@anomalous.materials"
        ],
        "Urgent Response": [
            "ops@example.com",
            "b.calhoun@security.mesa"
        ]
    },
    contacts: [
        ...DUMMY_CONTACTS,
        {
            name: "International Support",
            email: "support.uk@example.com",
            phone: "+44 20 7123 4567 | 00 1 202 555 0123",
            title: "Global Helpdesk",
            _searchString: "international support global helpdesk",
            raw: {}
        },
        {
            name: "Internal Ops",
            email: "ops.internal@example.com",
            phone: "x4567, 555-0199",
            title: "Internal Systems",
            _searchString: "internal ops internal systems",
            raw: {}
        }
    ],
    servers: [
        {
            name: "PROD-WEB-01",
            businessArea: "Retail",
            lob: "Digital",
            comment: "Main web server for customer portal",
            owner: "Sarah Connors",
            contact: "John Smith",
            os: "Windows 2022",
            _searchString: "prod-web-01 retail digital main web server sarah connors john smith windows 2022"
        },
        {
            name: "PROD-DB-02",
            businessArea: "Finance",
            lob: "Banking",
            comment: "Core transaction database",
            owner: "Emily Davis; Michael Brown",
            contact: "Information Technology",
            os: "RHEL 9",
            _searchString: "prod-db-02 finance banking core transaction database emily davis michael brown information technology rhel 9"
        },
        {
            name: "DEV-APP-01",
            businessArea: "Internal",
            lob: "HR",
            comment: "HR portal development",
            owner: "Michael Brown",
            contact: "it.support@example.com",
            os: "Ubuntu 22.04",
            _searchString: "dev-app-01 internal hr hr portal development michael brown ubuntu 22.04"
        },
        {
            name: "MESA-SEC-05",
            businessArea: "Security",
            lob: "Facilities",
            comment: "Site surveillance monitoring",
            owner: "Barney Calhoun",
            contact: "b.calhoun@security.mesa",
            os: "CentOS 7",
            _searchString: "mesa-sec-05 security facilities site surveillance monitoring barney calhoun security mesa centos 7"
        },
        {
            name: "ANOM-LAB-01",
            businessArea: "Research",
            lob: "Materials",
            comment: "Experimental processing unit",
            owner: "Gordon Freeman; Dr. Alice Vance",
            contact: "alice.vance@research.labs",
            os: "Oracle Linux",
            _searchString: "anom-lab-01 research materials experimental processing unit gordon freeman dr alice vance oracle linux"
        },
        {
            name: "WIN-MGMT-03",
            businessArea: "IT",
            lob: "Infrastructure",
            comment: "AD Domain Controller",
            owner: "Sarah Connors",
            contact: "john.smith@example.com",
            os: "Win Server 25",
            _searchString: "win-mgmt-03 it infrastructure ad domain controller sarah connors win server 25"
        }
    ],
    lastUpdated: Date.now()
};
