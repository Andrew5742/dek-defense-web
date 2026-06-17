const path = require('path');

module.exports = async function afterPackIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { rcedit } = await import('rcedit');
  const productFilename = context.packager.appInfo.productFilename || 'DEK Defense Station';
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico');

  await rcedit(exePath, {
    icon: iconPath,
    'file-version': context.packager.appInfo.version,
    'product-version': context.packager.appInfo.version,
    'version-string': {
      CompanyName: 'DEK Defense',
      FileDescription: 'DEK Defense Station',
      ProductName: 'DEK Defense Station',
      OriginalFilename: `${productFilename}.exe`
    }
  });
};
