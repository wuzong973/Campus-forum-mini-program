const TECHNICIANS = [
  { name: '莫旭卿', phone: '19200444855' },
  { name: '冯广兴', phone: '13450662913' },
  { name: '蒋文鑫', phone: '15314270546' },
  { name: '张彬浩', phone: '13543233827' },
  { name: '欧阳文展', phone: '13726084801' }
]

function findTechnician(phone) {
  return TECHNICIANS.find((technician) => technician.phone === String(phone || '')) || null
}

module.exports = { TECHNICIANS, findTechnician }
