/**
 * One-time script: insert all vendor records into Supabase.
 * Run AFTER applying seed_migration.sql in Supabase SQL Editor.
 * Usage:  cd backend && node seed_vendors.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

let _seq = 0;
function genId(prefix) {
  return `${prefix}${Date.now().toString().slice(-6)}${String(++_seq).padStart(3, "0")}`;
}

function parseCSV(text) {
  const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let inQuote = false, field = "", fields = [];
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === '"') {
      if (inQuote && norm[i + 1] === '"') { field += '"'; i++; }
      else inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      fields.push(field.trim()); field = "";
    } else if (c === "\n" && !inQuote) {
      fields.push(field.trim()); rows.push(fields); fields = []; field = "";
    } else {
      field += c;
    }
  }
  if (fields.length || field) { fields.push(field.trim()); rows.push(fields); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.toLowerCase());
  return rows.slice(1).filter(r => r.some(v => v)).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ""; });
    return obj;
  });
}

function normalizeVendorRow(row) {
  const comm = parseFloat(row["commission %"] || row.commission || "");
  const rat  = parseFloat(row["rating (1-5)"] || row.rating || row.score || "");
  return {
    vendor_code:      row["vendor code"]    || row.vendor_code    || "",
    name:             row["company name"]   || row.name || "",
    contact_person:   row["contact person"] || "",
    email:            row.email             || "",
    email2:           "",
    phone:            row["phone 1"]        || row.phone || "",
    phone2:           row["phone 2"]        || "",
    website:          row.website           || "",
    city:             row["office / city"]  || "",
    country:          row["base country"]   || "",
    destination:      row["destinations covered"] || "",
    category:         row.category          || "",
    services:         row["services / specialty"] || "",
    hotel_properties: row["hotel properties"]     || "",
    rating:           isNaN(rat)  ? null : rat,
    commission:       isNaN(comm) ? null : comm,
    status:           row.status  || "Active",
    notes:            row.notes   || "",
  };
}

const CSV = `Vendor Code,Company Name,Category,Services / Specialty,Contact Person,Phone 1,Phone 2,Email,Website,Office / City,Base Country,Destinations Covered,Hotel Properties,Rating (1-5),Commission %,Status,Notes
DOM-001,Ananda Holidays,Domestic DMC,Tour Packages,Anjeet Kumar,+91 9359973227,+91 9456563021,,aanandaholidays.com,Rishikesh,India,Chardham,,,,Active,
DOM-002,Andaman DMC,Domestic DMC,Tour Packages,Anjali Singh,+91 7718877739,+91 7777004283,contact@andamandmc.com,andamadmc.com,Port Blair,India,Andaman,,,,Active,
DOM-003,Balaji Travel,Domestic DMC,Tour Packages,Vivek Dubey,+91 8934011111,,gm@balajitravels.org,balajitravels.org,Varanasi,India,"Uttar Pradesh, Nepal, Bihar",,,,Active,
DOM-004,Bharat Booking,Domestic DMC,Tour Packages,Oman Khatri,+91 9816348636,+91 9218061636,marketinf@bharatbooking.com,,Manali,India,Himachal Pradesh,,,,Active,
DOM-005,BNI (The Holiday Point),"Domestic DMC, International DMC","Tour Packages, Temple Tours (India)",Nandkishor Verma,+91 9899690208,011-40606266,info@theholidaypoint.com,theholidaypoint.com,Delhi,India,"Andaman, Kashmir, Ladakh, Kerala, Rajasthan, Himachal Pradesh, Uttarakhand, Chardham, Amarnath, Bali, Singapore, Thailand, Malaysia, Kazakhstan, Vietnam, Azerbaijan, Dubai (UAE), Georgia",,,,Active,
DOM-006,Book N Travel,Domestic DMC,Tour Packages,Rini Jain,+91 9886699322,,rini.jain@bookntravel.in,,Bengaluru,India,Karnataka,,,,Active,
DOM-007,Carol Holidays,Domestic DMC,Tour Packages,Fayaz Mir,+91 9906565635,,carolholidays.kashmir@gmail.com,carolholidays.com,,India,"Kashmir, Ladakh",,,,Active,
DOM-008,Colourful Holidayss,Domestic DMC,"Tour Packages, Spiritual Circuit, Pilgrimage Tours, Heritage Tours",Parmanand Singh,+91 9919690202,+91 9919690222,colourfulholidayss@gmail.com,colourfulholidayss.com,Varanasi,India,"Uttar Pradesh, Bihar, Nepal",,,,Active,
DOM-009,De Lamor Group,Domestic DMC,Tour Packages,Sinju Ann,+91 8714697901,,tours@lamorgroup.in,lamorygroup.in,Cochin,India,"Kerala, Karnataka, Tamil Nadu, Lakshadweep",,,,Active,
DOM-010,Diamond Hospitalities,Domestic DMC,Tour Packages,Sahil Bhatia,+91 7017542919,,tours@diamondhospitilities.com,diamondhospitalities.com,,India,Uttarakhand,,,,Active,
DOM-011,Do View Holidays,Domestic DMC,"Tour Packages, B2B Booking Portal",Promod Kumar,+91 7339387807,,upsales@dvi.co.in,beb.dvi.co.in,Chennai,India,"Tamil Nadu, Kerala, Karnataka, Andhra Pradesh, Telangana, Pondicherry",,,,Active,
DOM-012,Epic Yatra,Domestic DMC,Tour Packages,Pratibha Tripathi,+91 8510003060,,epicyatra@gmail.com,epicyatra.com,Noida,India,Uttar Pradesh,,,,Active,
DOM-013,Explore Heaven Holiday,Domestic DMC,Tour Packages,Kamran Bhat,+91 7889555057,,info@exploreheavenholidays.com,exploreheavenholidays.com,Srinagar,India,"Kashmir, Leh Ladakh, Vaishno Devi, Amarnath",,,,Active,
DOM-014,G S Tour And Travel,Domestic DMC,Tour Packages,Ashok Kumar,+91 9842336383,+91 9629225999,maduraitour@gmail.com,,Madurai,India,"Tamil Nadu, Madurai, Rameshwaram, Kanyakumari, Chennai, Pondicherry, Coimbatore",,,,Active,
DOM-015,Gita Tour And Travels,Domestic DMC,Tour Packages,,+91 9933248499,+91 9474205999,gitatourandtravels@gmail.com,,,India,Andaman,,,,Active,
DOM-016,Go Andaman,Domestic DMC,Tour Packages,Tapas KR Mistry,+91 7846006970,+91 9933202457,,,,India,Andaman,,,,Active,
DOM-017,Go4 Holidays,Domestic DMC,Tour Packages,Mdhu Sudhan,+91 9849040313,040-35549671,go4holidaysmadhu@gmail.com,go4holidays.co.in,Telangana,India,"Hyderabad, Srisailam, Yadagirigutta, Bhadrachalam, Papikondalu, Warangal, Vemulawada, Tirupati, Visakhapatnam, Araku Valley",,,,Active,
DOM-018,Haniefa Tour And Travel,Domestic DMC,Tour Packages,Ashsam,+91 8899227815,,b2b@hanieftravels.com,haiefatravels.com,Srinagar,India,"Ladakh, Kashmir",,,,Active,
DOM-019,Holiday Mechanic,Domestic DMC,Tour Packages,Rajesh,+91 9810798923,+91 8920730080,operation@holidaymechanic.com,,Bhubaneswar,India,Odisha,,,,Active,
DOM-020,India B2B,Domestic DMC,Tour Packages,Jahanvi Parmar,0731-4066990,2436620,business@mpincoming.com,mpincoming.com,,India,Madhya Pradesh,,,,Active,
DOM-021,Indus Serenity,Domestic DMC,Tour Packages,,+91 7447444515,+91 8899322681,indusserenity@gmail.com,indusserenity.com,Leh Ladakh,India,Leh Ladakh,,,,Active,
DOM-022,Inland Tourways,Domestic DMC,Tour Packages,Sneha Barwal,+91 9217504445,+91 9726467345,info@inlandtourways.com,inlandtourways.com,Delhi,India,"Gujarat, Uttar Pradesh",,,,Active,
DOM-023,KTEC Tour,Domestic DMC,Tour Packages,Pallavi,+91 9852562249,+91 7541061022,sales@ktectours@gmail.com,ketechtours.com,Bodhgaya,India,Bihar,,,,Active,
DOM-024,Ladakh Elysium,Domestic DMC,"Tour Packages, Nubra Valley Camp",ST Lamo,+91 9622181001,+91 9622256088,ladakhelysiumcamp@gmail.com,ladakhelysiumcamps.com,,India,Ladakh,,,,Active,
DOM-025,MP Holidays,Domestic DMC,Tour Packages,Mayank Jain,+91 8745000242,+91 9319184060,welcome@mpholidays.in,mpholidays.in,Delhi,India,Madhya Pradesh,,,,Active,
DOM-026,MP Top Tours,Domestic DMC,"Tour Packages, Jungle Safari",BM Khan,+91 9303705070,,mptours@gmail.com,,,India,Madhya Pradesh,,,,Active,
DOM-027,MP Tours India,Domestic DMC,Tour Packages,Vikas Dubey,+91 9893263533,0755-4220121,salesh@mptours.in,mptours.in,Bhopal,India,"Bhopal, Madhya Pradesh",,,,Active,
DOM-028,Narayani,Domestic DMC,Tour Packages,Kishan Patel,+91 9586823230,,kishan.patel@narayaniholidays.com,narayaniholidays.com,,India,"Karnataka, Gujarat",,,,Active,
DOM-029,Shiny Adventure,Domestic DMC,"Tour Packages, Ski Trekking, Camps",Tariq Ahmad,+91 9186122235,+91 6005399813,shinyadventures49@gmail.com,,Srinagar,India,"Kashmir, Ladakh",,,,Active,
DOM-030,Shiv Bhole Travel,Domestic DMC,Tour Packages,Kirti Gulati,+91 9540067400,,,,Delhi,India,Chardham,,,,Active,
DOM-031,Skyway International,Domestic DMC,Tour Packages,Venugopalan,+91 9845183542,,venu@skywaytour.com,,Bangalore,India,"Hyderabad, Madikeri, Mangalore, Mysuru, Karnataka, Kerala",,,,Active,
DOM-032,Star World Holidays,Domestic DMC,Tour Packages,Adeeba Khan,+91 9650868266,,info@starworldholidays.in,,Delhi,India,"Chhattisgarh, Kashmir, Ladakh, Amritsar",,,,Active,
DOM-033,Taruk Travels,Domestic DMC,Tour Packages,Seerat,+91 8899222826,,b2b@taruktravels.com,,,India,Jammu & Kashmir,,,,Active,
DOM-034,The Kumar Hospitality,Domestic DMC,Tour Packages,Sagar Jaisingani,+91 9811058997,,info@thekumarhospitality.com,thekumarhospitality.com,Haridwar,India,Chardham,,,,Active,
DOM-035,The Titanic Holiday,Domestic DMC,Tour Packages,Munish Sharma,+91 9711507080,+91 7056507080,infor@thetitanicholdays.com,thetitanicholidays.com,Delhi,India,"Chardham, Uttarakhand, Amarnath, Kashmir, Himachal Pradesh, Spiti Valley, Rajasthan",,,,Active,
DOM-036,Travel With Nature,Domestic DMC,"Tour Packages, Skiing",Saba Bhat,+91 9149559925,,,travelwithnature.in,,India,"Kashmir, Leh Ladakh, Amarnath, Vaishno Devi",,,,Active,
DOM-037,Tribal Planet Tours & Travel,Domestic DMC,Tour Packages,Pranjal Pratim,+91 9577132575,,info@tribalplanet.in,tribalplanet.in,Guwahati,India,"North East, Bhutan, Sikkim",,,,Active,
DOM-038,Uttarakhand Vacation,Domestic DMC,Tour Packages,Mansi Pandey,+91 7456819266,+91 7533820425,info@uttarakhandvacation.com,,Ramnagar,India,"Uttarakhand, Chardham, Himachal Pradesh",,,,Active,
DOM-039,Way To Vacations,Domestic DMC,Tour Packages,Vaibhow Solanki,+91 7291973547,+91 9142202628,ops@way2vacations.com,way2vacations.com,Delhi,India,"Uttar Pradesh, Bihar, Odisha",,,,Active,
DOM-040,Zen National,Domestic DMC,Tour Packages,Faheem Uddin,+91 9246575202,+91 8977503202,zennationalhyd@gmail.com,,Hyderabad,India,Telangana,,,,Active,"Name spelled ""Zen Nationl"" in source"
INT-001,360 Tours,International DMC,Tour Packages,Charith Wanigarathna,+94 779301088,,360tourslankacharith@gmail.com,360tourslanka.com,Sri Lanka,Sri Lanka,Sri Lanka,,,,Active,
INT-002,ABS Thai DMC,International DMC,Tour Packages,Pankaj Madan,+91 9971314355,011-49052898,sales@absthaidmc.com,absthaidmc.com,,India,Thailand,,,,Active,
INT-003,ADI Holiday LLC,International DMC,Tour Packages,Shefta,+91 9289125996,0120-4349438,b2b@adiholiday.com,adiholiday.com,Noida,India,Dubai (UAE),,,,Active,
INT-004,Asian Classic Travels,International DMC,Tour Packages,Sapna D,+91 9871456563,+91 8219354140,sapna@asianclassictravels.com,asianclassictravels.com,"Dharamshalla, Indonesia, Singapore, Vietnam",India,"Singapore, Vietnam, Cambodia, Indonesia, UAE",,,,Active,
INT-005,Aussie Grand Tour,International DMC,Tour Packages,Utpal Dhar,+91 8178739955,011-47420000,b2b@aussiegrandtour.com.au,aussiegrandtour.com.au,Delhi,India,"Australia, New Zealand",,,,Active,
INT-006,Caper Travel,International DMC,Tour Packages,Prkhar Lunial,+91 9871123663,0124-4600300,info@caper.in,capertravelindia.com,Gurugram,India,"Sri Lanka, Maldives, Russia, Egypt, Georgia, Philippines",,,,Active,
INT-007,Ceylon Roots,International DMC,Tour Packages,Asanka Nakandala,+94 117701448,+94 764578043,asnkanaka@ceylonroots.com,ceylonroots.com,Sri Lanka,Sri Lanka,Sri Lanka,,,,Active,
INT-008,DMC Bazaar,International DMC,Tour Packages,,,,,,,India,,,,,Active,Only the company name is in the source list - contact details missing
INT-009,DMC Square,International DMC,Tour Packages,SM Husain,+91 7680938787,,syed.h@wwdmc.com,wwdmc.com,Hyderabad,India,"USA, UAE, Australia, Indonesia, Vietnam",,,,Active,
INT-010,DMC Wale,International DMC,Tour Packages,Gautam Bharadwaj,+91 9999797931,011-43549394,gautam@dmcwale.com,dmcwale.com,Delhi,India,"Turkey, Morocco, Europe, Egypt, Jordan",,,,Active,
INT-011,Dream Tibet,International DMC,"Tour Packages, Kailash Tour, Tibet Biking",Ram Clamichhane,+977 9851162422,,info@dreamtibet.com,dreamtibet.com,Nepal,Nepal,"Tibet, Bhutan",,,,Active,
INT-012,Hayleys Travels,International DMC,Tour Packages,Achalanga Ayagama,+94 717258943,+94 766887536,achalanga.ayagama@hayleystravels.com,srilankawithhayleys.com,Sri Lanka,Sri Lanka,Sri Lanka,,,,Active,
INT-013,Holiday World,International DMC,Tour Packages,K Vijay Mohan,+91 9966899668,,vijaymohan@holidayworldindia.com,holidayworldindia.com,Delhi,India,"Vietnam, Cambodia, Sri Lanka, Hong Kong, Nepal, USA, Australia, Russia, Bangladesh",,,,Active,
INT-014,India China Travel Expert,International DMC,Tour Packages,Mr. Edward Le,+84 364702495,,sales@indochinatravelexpert.com,,Vietnam,Vietnam,"Vietnam, Cambodia, Laos, China",,,,Active,
INT-015,Journeyline Travels,International DMC,Tour Packages,Kanishka,+94 707773703,+94 112071014,kanishka@journeylinetravels.com,journeylinetravels.com,,Sri Lanka,Sri Lanka,,,,Active,Phone 1 is WhatsApp
INT-016,Khushi Travels,International DMC,Tour Packages,Dinesh Koirala,+977 9768988868,+977 9741707759,info@khushiservices.com,khushiservices.com,Nepal,Nepal,Nepal,,,,Active,
INT-017,Luxxata,International DMC,Tour Packages,Amit Katyal,+91 8595187025,,booking@luxxata.com,luxxata.com,,India,"Egypt, Jordan, Morocco, Turkey, Georgia, Azerbaijan, Kazakhstan, Uzbekistan, Armenia",,,,Active,
INT-018,Mekong Vacations,International DMC,Tour Packages,Samarjit Biswas,+91 9831996176,,samarjit.b@mekongvacations.com,mekongvacations.com,,India,"Thailand, Vietnam, Indonesia, Philippines, Cambodia, Laos",,,,Active,
INT-019,Nam Ho DMC,International DMC,Tour Packages,Soumen Rakshit,+91 6294431441,011-40079173,soumen@nahodmc.com,namhodmc.com,,India,"Singapore, Malaysia, UAE, Australia",,,,Active,
INT-020,Ons Travels,International DMC,Tour Packages,Nabah Rizvi,+91 9821894858,+91 9871700611,nabhah.rizvi@onstravels.com,onstravels.com,Delhi,India,"Azerbaijan, Almaty, Georgia, Kazakhstan, Uzbekistan, Vietnam",,,,Active,
INT-021,Saigonese Tourist,International DMC,Tour Packages,Mrs Helen Hang,+84 977616146,+84 908742874,rosle@saigonesetourisht.com,,Ho Chi Minh City,Vietnam,Vietnam,,,,Active,
INT-022,Sri Lankan Footprints,International DMC,Tour Packages,Chirag Nemchand,+91 9833370875,,chirag@srilankanfootprints.com,srilankanfootprints.com,,India,"Sri Lanka, New Zealand",,,,Active,
INT-023,TDE,International DMC,Tour Packages,Neeraj Kumar Ailwadi,+91 9871914758,,info@thedmcexperts.com,thedmcexperts.com,Delhi,India,"Greece, Dubai (UAE), Oman, Azerbaijan, Darjeeling, Sikkim",,,,Active,
INT-024,Teem Travel Bhutan,International DMC,Tour Packages,Hem Lal Sharma,+975 17834868,+975 77300786,ttbhutan7@gmail.com,teembhutan.com,,Bhutan,Bhutan,,,,Active,
INT-025,UR Travel,International DMC,Tour Packages,,+91 8169105608,,fayaz@urtravel.hk,,"Mumbai, Hongkong",India,"Hong Kong, Macau, China",,,,Active,
INT-026,Victoria Tour,International DMC,Tour Packages,Ram Chandra,+91 9625968325,,delhi@victoriatour.com.vn,victoriatour.com,"Delhi, Hanoi",India,"Laos, Hong Kong, Philippines, Russia, CIS, Vietnam",,,,Active,
INT-027,World Trip DMC,International DMC,Tour Packages,Avdhesh Kumar,+91 8770576562,0120-4168027,avdhesh@worldtripdmc.com,,"Noida, Hongkong, Vietnam",India,"Hong Kong, Vietnam, Thailand",,,,Active,
INT-028,Yorker DMC,International DMC,Tour Packages,Vishal R Sharma,+91 9910698003,,ops28@yorkerindia.com,yorkerindia.com,"Delhi, Japan",India,,,,,Active,
HTL-001,7 Apple Hotels,Hotel,Hotels,Noamaan Ansari,+91 8976174222,,sm1.delhi@7applehotels.com,,,India,"Aurangabad, Bikaner, Goa, Jalmahal Jaipur, Khandal, Lonavala, Nashik, Navi Mumbai, Pune, Vadodara, Visakhapatnam",,,,Active,
HTL-002,Achrol Niwas,Hotel,Hotels,Jaivardhan,+91 7568348590,,foachrol@treehousehotels.in,treehousehotels.in,,India,"Ranthambore, Jaipur",,,,Active,
HTL-003,BBH Group,Hotel,Hotels,Maninder Sing,+91 9218115636,,info@bbhhotelandresorts.com,,,India,"Kullu, Manali",,,,Active,
HTL-004,Chevron,Hotel,Hotels,Radhika,+91 9891649870,+91 9810006395,sales@chevronhotels.com,chevronhotels.com,Delhi,India,"Uttarakhand, Nainital, Ranikhet, Kausani, Mukteshwar, Dehradun",,,,Active,
HTL-005,Corbett Sapphire Resort,Hotel,Hotels,Devendra,+91 9258255941,,,,,India,,,,,Active,
HTL-006,DLS Hotels,Hotel,Hotels,Rahul Manocha,+91 8894255747,,reservation@dlshotels.in,dlshotels.in,,India,"Uttarakhand, Himachal Pradesh, Mussoorie, Kasauli, Tehri Chamba, Shimla, Rishikesh, Manali, Dehradun, Dharamshala, Jim Corbett, Dalhousie, Nainital",,,,Active,
HTL-007,Eastend Hotel & Resort,Hotel,Hotels,Nithin Jose,+91 9446001496,,gmbd@eastend.in,,,India,"Munnar, Kumarakom, Aluva, Chalakudy",,,,Active,
HTL-008,Excel Group,Hotel,Hotels,Ayush,+91 7055362345,,,,,India,"Noida, Jim Corbett, Bhimtal",,,,Active,
HTL-009,Hotel Sea Rock,Hotel,Hotels,Upesh,+91 9995481535,,reservations@hotelsearock.in,,,India,Kovalam,,,,Active,
HTL-010,Hotel Taika,Hotel,Hotels,Sirajudeen,+91 6369299880,,,,Rameshwaram,India,Rameshwaram,,,,Active,
HTL-011,IO Hotels,Hotel,Hotels,Navneet Kashyap,+91 9988379259,,sales@iohotels.in,iohotels.com,Amritsar,India,Amritsar,"Maribella Hotel & Resorts, Classio Royale, Mannat Residency, Taj Castle, RRR Hotel",,,Active,
HTL-012,Jeevan Beach Resort,Hotel,Hotels,Umesh,+91 9995489662,,jeevanresorts@gmail.com,,,India,Kovalam,,,,Active,
HTL-013,Justa Hotel,Hotel,Hotels,Dinesh,+91 9999889098,+91 9811247229,rohit.tatyal@justahotels.com,justahotels.com,,India,"Delhi, Goa, Gujarat, Haryana, Himachal Pradesh, Karnataka, Maharashtra, Rajasthan, Tamil Nadu, Uttarakhand",,,,Active,
HTL-014,Leisure Hotels,Hotel,Hotels,Manoj Mathpal,+91 9667325444,95555088000,manoj.mathpal@leisurehotels.in,leisurehotels.in,,India,"Nainital, Corbett, Naukuchiatal, Bhimtal, Kausani, Rishikesh, Haridwar, Kanatal, Kasauli, Manali, Dharamshala, Mcleodganj, Varanasi, Goa, Kashipur, Bareilly, Vrindavan, Greater Noida, Dehradun, Ranthambore, Jaipur",,,,Active,
HTL-015,Lemon Tree,Hotel,Hotels,Deepak Pawar,+91 9871266992,011-45232323,sales12@lemontreehotels.com,,,India,"Madurai, Kodaikanal",,,,Active,
HTL-016,Lords Hotel & Resort,Hotel,Hotels,Abhishekh,+91 8527622777,011-41090290,,lordshotels.com,Delhi,India,,,,,Active,40+ hotels across India
HTL-017,Orange Tiger Hospitality,Hotel,Hotels,Rajeev Mamyotra,+91 9958691777,,rajeev.mamyotra@orangetigerhotels.com,,Maharashtra,India,,,,,Active,45+ hotels across India
HTL-018,Radisson,Hotel,Hotels,Varun,+91 9717733086,,,,,India,,,,,Active,Sales Pan India
HTL-019,Rio Grande,Hotel,Hotels,G Sivasubramaniam,+91 7550349222,,,,,India,,,,,Active,
HTL-020,Rosetum,Hotel,Hotels,Arun Khanna,+91 7876503104,,head.pm@rosetum.com,,,India,"Kasauli, Goa",,,,Active,
HTL-021,Shree Gokulam Hotel & Resort,Hotel,Hotels,Joy Erick,+91 8606963228,,rso.delhi@gokulamhotels.com,,Delhi,India,"Kovalam, Kochi, Guruvayur, Trivandrum, Munnar, Thrissur, Kumarakom, Manjeri, Kozhikode, Neeleshwaram, Thalassery, Coorg, Coimbatore, Gudalur, Bangalore, Chennai, Ballari","Gokulam Grand: Kovalam, Trivandrum, Kumarakom, Kozhikode, Coorg, Bangalore | Gokulam Park: Kochi, Munnar, Guruvayur, Neeleshwaram, Coimbatore, Chennai, Ballari | Gokulam Residency: Guruvayur, Thrissur, Manjeri, Thalassery, Gudalur",,,Active,Region: South India
HTL-022,Sonar Bangla,Hotel,Hotels,Sreya Majumdar,+91 8697972215,,reservations1@hotelsonarbangla.com,hotelsonarbangla.com,,India,"Tarapith, Darjeeling, Puri, Mandarmoni, Kolaghat, Taki, Sundarban, Mayapur",,,,Active,
HTL-023,Soulacia,Hotel,Hotels,Prerna,+91 9540871144,,,,,India,Kanha National Park,,,,Active,
HTL-024,Starlit Suite,Hotel,Hotels,Amit Pandey,+91 9871267999,011-41634844,sales.del@starlitsuites.com,,,India,"Kochi, Bengaluru, Neemrana, Tirupati, Shirdi, Kolkata",,,,Active,
HTL-025,Stone Wood,Hotel,Hotels,Vikas Kumar,+91 8485080184,,delhisales3@stonewoodresorts.com,stonewoodresorts.com,,India,"Goa, Udaipur, Kumbhalgarh, Dharamshala, Rishikesh, Dandeli, Gokarna, Amboli",,,,Active,
HTL-026,Tanwar Hotels,Hotel,"Hotels, Camps",Nitin Singh Tanwar,+91 7877838383,,,,,India,Alwar,,,,Active,
HTL-027,The Elegance Group Of Hotels,Hotel,Hotels,Venkatesh,+91 8810719091,,,,,India,Varanasi,,,,Active,
HTL-028,The Jungle Mountain Retreat,Hotel,Hotels,Satish,+91 8894880036,,,,,India,Shimla,,,,Active,
HTL-029,The Pine Stone,Hotel,Hotels,,+91 9070030050,,,,,India,"Dehwathu, Pahalgam, Anantnag",,,,Active,
HTL-030,The Retreat,Hotel,Hotels,,+91 7876926262,,,,,India,Shimla,,,,Active,
HTL-031,Treat Hotel And Resort,Hotel,Hotels,Ranjeet Singh,+91 6358234949,,ranjeet.s@treatresorts.com,,,India,"Delhi, Mumbai, Surat, Baroda, Ahmedabad",,,,Active,
HTL-032,Truly India,Hotel,"Hotels, Camps, Safari",Maninder Sing,+91 9328016886,079-23977600,sales@trulyyindiahotels.com,,Ahmedabad,India,"Gujarat, Udaipur, Kumbhalgarh, Jodhpur, Sam Sand Dunes, Jaisalmer, Sasan Gir, Little Rann Of Kutch, Jawai, Velavadar, Bhavnagar",,,,Active,
HTL-033,Vesta Hotel & Resorts,Hotel,Hotels,Sumit,+91 9251661515,,sales.delhi@vestahotels.com,,Delhi,India,"Jaipur, Udaipur, Bikaner, Pushkar",,,,Active,
HTL-034,WGH Hotel And Resort,Hotel,Hotels,Jijo John,+91 9447111726,,jijo@wghhotels.in,,Kochi,India,"Kerala, Munnar, Thekady, Alleppey","Tall Trees: Munnar | Poetree: Thekady | World Backwater: Alleppey",,,Active,
HTL-035,Wyndham,Hotel,Hotels,Nishant Harbola,+91 8588901547,,nishant.harbola@wyndham.com,,,India,,,,,Active,
TRN-001,Royal Travel,Transport / Cab,Cab / Taxi,Balkrishnan,+91 9942435457,+91 7373812345,b2b@royaltravels.in,chennaitaxi.com,,India,"Coimbatore, Chennai, Madurai, Bangalore, Mysore, Kanyakumari, Cochin, Trivandrum, Tirupati, Hyderabad",,,,Active,
TRN-002,Super Tour And Travel,Transport / Cab,Cab / Taxi,Raman Jha,+91 9334112486,+91 9835023111,stttaxi@gmail.com,,,India,Bihar,,,,Active,
CHR-001,Blue Heights Aviation,Charter / Aviation,"Private Jet, Helicopter Charter, Wedding Charter, Air Ambulance, Flower Dropping",Harshit Saxena,+91 8595831120,,charter@blueheightaviation.com,blueheightaviation.com,Delhi,India,Chardham,,,,Active,
VIS-001,Maitri Visa,Visa Services,Visa Processing,Parvesh Dhull,+91 9896974863,011-46016829,visa@mvtsindia.com,mvtsindia.com,,India,,,,,Active,
VIS-002,Travel Mudra,Visa Services,Visa Processing,Ashish Yadav,+91 8130823222,+91 9310375565,visa@travelmudra.co,travelmudra.co,,India,Global,,,,Active,`;

async function main() {
  const rows = parseCSV(CSV);
  const vendors = rows
    .map(normalizeVendorRow)
    .filter(v => v.name)
    .map(v => ({ id: genId("V"), ...v }));

  console.log(`Parsed ${rows.length} rows → ${vendors.length} valid vendors`);

  // insert in batches of 20 to avoid request size limits
  const BATCH = 20;
  let total = 0;
  for (let i = 0; i < vendors.length; i += BATCH) {
    const batch = vendors.slice(i, i + BATCH);
    const { data, error } = await db.from("vendors").insert(batch).select("id, name, vendor_code");
    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message);
      process.exit(1);
    }
    total += data.length;
    console.log(`  Batch ${Math.floor(i / BATCH) + 1}: inserted ${data.length} (${data.map(v => v.vendor_code || v.name).join(", ")})`);
  }
  console.log(`\nDone. Total inserted: ${total} vendors.`);
}

main().catch(e => { console.error(e); process.exit(1); });
