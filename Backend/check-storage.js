const supabase = require('./Config/db');

async function checkBucket(bucketName) {
    console.log(`\n================================`);
    console.log(`BUCKET: ${bucketName}`);
    console.log(`================================`);

    const { data, error } = await supabase
        .storage
        .from(bucketName)
        .list('', {
            limit: 100,
            offset: 0
        });

    if (error) {
        console.log('ERROR:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('EMPTY');
        return;
    }

    console.table(
        data.map(file => ({
            name: file.name,
            id: file.id,
            size: file.metadata?.size || '',
            mimetype: file.metadata?.mimetype || '',
            created: file.created_at || ''
        }))
    );
}

async function main() {
    await checkBucket('student_records');
    await checkBucket('student_files');
    await checkBucket('student_photos');
}

main();