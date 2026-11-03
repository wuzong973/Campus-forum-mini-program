const TECHNICIANS = Array.from({ length: 5 }, (_, index) => {
  const number = index + 1
  const phone = String(process.env[`REPAIR_TECHNICIAN_${number}_PHONE`] || '').trim()
  if (!phone) return null
  if (!/^1\d{10}$/.test(phone)) {
    throw new Error(`REPAIR_TECHNICIAN_${number}_PHONE must be a valid mobile number`)
  }
  return { id: `technician-${number}`, name: `\u7ef4\u4fee\u5e08\u5085 ${number}`, phone }
}).filter(Boolean)

function findTechnician(idOrPhone) {
  const value = String(idOrPhone || '')
  return TECHNICIANS.find((technician) => technician.id === value || technician.phone === value) || null
}

module.exports = { TECHNICIANS, findTechnician }
