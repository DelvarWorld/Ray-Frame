var hover = hover = new Element('a').addClass('edit_btn').addEvent('click', editClick),
	cancel = new Element('a').addClass('cancel_btn').addEvent('click', cancelClick),
	send = new Element('a').addClass('send_btn').addEvent('click', sendClick),
	currentEditor = {};
	
window.addEvent('domready', function() {
	var pos;
	$$('.edit_me').each(function(item) {
		pos = item.getPosition();
		hover.setStyles({top:pos.y, left:pos.x}).inject(document.body).match = item;
	});
});

function editClick(evt) {
	currentEditor.edit = evt.target.setStyles({display: 'none'});
	currentEditor.target = evt.target.match.setStyles({display:'none'});
	var pos = evt.target.match.getPosition();

	currentEditor.cancel = cancel.setStyles({top:pos.y, left:pos.x}).inject(document.body);
	currentEditor.send = send.setStyles({top:pos.y, left:pos.x + 15}).inject(document.body);

	evt.target.match.setStyles({display:'none'});
	buildEditor(evt.target.match.get('id'));
}

function buildEditor(id) {
	currentEditor.input = new Element('input').set({type: 'text', value:$(id).get('html')}).inject($(id), 'after');
}

function sendClick(evt) {
	new Request.JSON({
		url: '/update',
		data: {field:currentEditor.target.get('id'), value:currentEditor.input.get('value')},
		onSuccess: function(data) {
			currentEditor.target.set('html', data.new_value);
		}
	}).send();
	closeEdit(evt.target.match);
}

function cancelClick() {
	closeEdit();
}

function closeEdit(item) {
	currentEditor.cancel.setStyle('display', 'none');
	currentEditor.send.setStyle('display', 'none');
	currentEditor.input.destroy();
	currentEditor.target.setStyles({display: 'block'});
	currentEditor.edit.setStyles({display: 'block'});
}
